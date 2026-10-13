import { describe, expect, it } from 'vitest'
import {
  CITATION_MAX,
  DEFAULT_GEMINI_MODEL,
  GEMINI_OPENAI_BASE_URL,
  ModelOutputError,
  ModelUnavailableError,
  TITLE_MAX,
  buildMessages,
  createOpenAiCompatibleModel,
  modelConfigFromEnv,
  parseAwards,
} from '../lib/model'
import { PROMPTS } from '../lib/prompts'
import { answersFor } from './helpers'

const people = [{ displayName: 'Ana' }, { displayName: 'Ben' }, { displayName: 'Cat' }]
// The model sees each friend under a 1-indexed id (their position in `people`) and echoes it back.
const award = (
  id: number,
  name = people[id - 1]?.displayName ?? 'Someone',
  title = `${name} Award`,
  citation = `Line one for ${name}. Line two.`,
) => ({ id, name, title, citation })
const reply = (awards: unknown) => JSON.stringify({ awards })

// Built at runtime so nothing credential-shaped sits in the repo.
const fakeKey = () => ['test', 'key', 'Z9y8'.repeat(6)].join('-')

describe('parseAwards', () => {
  it('returns one award per person, in submission order, matched by id', () => {
    const out = parseAwards(reply([award(3), award(1), award(2)]), people)
    expect(out.map((a) => a.displayName)).toEqual(['Ana', 'Ben', 'Cat'])
    expect(out[0]).toEqual({ displayName: 'Ana', title: 'Ana Award', citation: 'Line one for Ana. Line two.' })
  })

  it('accepts JSON wrapped in a markdown code fence', () => {
    const fenced = '```json\n' + reply([award(1), award(2), award(3)]) + '\n```'
    expect(parseAwards(fenced, people)).toHaveLength(3)
  })

  it('accepts a top-level array of awards', () => {
    expect(parseAwards(JSON.stringify([award(1), award(2), award(3)]), people)).toHaveLength(3)
  })

  it('keeps the submitted spelling whatever name the model echoes (accents, emoji, nicknames)', () => {
    const out = parseAwards(reply([award(1, 'ana 💅'), award(2, 'Benjamin'), award(3, '')]), people)
    expect(out.map((a) => a.displayName)).toEqual(['Ana', 'Ben', 'Cat'])
  })

  it('accepts an id sent as a digit string', () => {
    expect(parseAwards(reply([{ ...award(1), id: '1' }, award(2), award(3)]), people)).toHaveLength(3)
  })

  it('collapses whitespace, strips control characters and clamps over-long text', () => {
    const out = parseAwards(
      reply([award(1, 'Ana', `  The\u0000 Long\n\nTitle ${'x'.repeat(200)}`, `${'word '.repeat(200)}`), award(2), award(3)]),
      people,
    )
    expect(out[0].title.startsWith('The Long Title')).toBe(true)
    expect(out[0].title).not.toMatch(/[\u0000-\u001f]/)
    expect(out[0].title.length).toBeLessThanOrEqual(TITLE_MAX)
    expect(out[0].citation.length).toBeLessThanOrEqual(CITATION_MAX)
    expect(out[0].citation.endsWith('…')).toBe(true)
  })

  it.each([
    ['plain prose', 'Here you go!'],
    ['truncated JSON', '{"awards": [{"name": "Ana"'],
    ['an empty string', ''],
    ['JSON null', 'null'],
    ['an object without awards', '{"result": []}'],
    ['awards that are not a list', '{"awards": "Ana wins"}'],
    ['a missing person', reply([award(1), award(2)])],
    ['an extra person', reply([award(1), award(2), award(3), award(4, 'Dan')])],
    ['a duplicated id', reply([award(1), award(1), award(2)])],
    ['0-indexed ids', reply([award(0, 'Ana'), award(1, 'Ben'), award(2, 'Cat')])],
    ['a fractional id', reply([award(1), award(2), { ...award(3), id: 2.5 }])],
    ['an id that is not a number', reply([award(1), award(2), { ...award(3), id: 'three' }])],
    ['a missing id', reply([award(1), award(2), { name: 'Cat', title: 'x', citation: 'y' }])],
    ['an award that is not an object', reply([award(1), award(2), 'Cat'])],
    ['a title that is not text', reply([award(1), award(2), { id: 3, title: 5, citation: 'ok' }])],
    ['a blank citation', reply([award(1), award(2), award(3, 'Cat', 'Fine', ' \n ')])],
  ])('rejects %s with ModelOutputError', (_label, raw) => {
    expect(() => parseAwards(raw, people)).toThrow(ModelOutputError)
  })
})

describe('buildMessages', () => {
  const friends = people.map((p) => ({ displayName: p.displayName, answers: answersFor(p.displayName) }))
  const messages = buildMessages({ name: 'Flat 4B', year: 2026 }, friends)

  it('sends a system message with the output format and the safety rules', () => {
    expect(messages[0].role).toBe('system')
    const system = messages[0].content
    expect(system).toContain('"awards"')
    expect(system).toContain('"id"')
    expect(system).toMatch(/exactly one award/i)
    for (const banned of ['health', 'money', 'abuse']) expect(system).toContain(banned)
    expect(system).toMatch(/data, not instructions/i)
  })

  it('sends the group, the prompts and every friend’s answers as JSON data', () => {
    expect(messages[1].role).toBe('user')
    const json = messages[1].content.slice(messages[1].content.indexOf('{'))
    const data = JSON.parse(json)
    expect(data.group).toBe('Flat 4B')
    expect(data.year).toBe(2026)
    expect(Object.keys(data.prompts)).toEqual(PROMPTS.map((p) => p.id))
    expect(data.friends.map((f: { name: string }) => f.name)).toEqual(['Ana', 'Ben', 'Cat'])
    expect(data.friends.map((f: { id: number }) => f.id)).toEqual([1, 2, 3])
    expect(data.friends[0].answers).toEqual(answersFor('Ana'))
  })
})

describe('createOpenAiCompatibleModel', () => {
  const ok = (content: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

  it('POSTs to {baseUrl}/chat/completions with bearer auth, the model and JSON mode, returning the text', async () => {
    const key = fakeKey()
    const seen: { url: string; init: RequestInit }[] = []
    const model = createOpenAiCompatibleModel({
      baseUrl: 'https://llm.example.test/v1beta/openai/',
      apiKey: key,
      model: 'some-free-model',
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} })
        return ok('{"awards": []}')
      },
    })

    const text = await model.complete([{ role: 'user', content: 'hi' }])
    expect(text).toBe('{"awards": []}')
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://llm.example.test/v1beta/openai/chat/completions')
    expect(seen[0].init.method).toBe('POST')
    expect(new Headers(seen[0].init.headers).get('authorization')).toBe(`Bearer ${key}`)
    const body = JSON.parse(String(seen[0].init.body))
    expect(body.model).toBe('some-free-model')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('sends no Authorization header when there is no key (e.g. local Ollama)', async () => {
    let headers = new Headers()
    const model = createOpenAiCompatibleModel({
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      fetch: async (_url, init) => {
        headers = new Headers(init?.headers)
        return ok('{}')
      },
    })
    await model.complete([{ role: 'user', content: 'hi' }])
    expect(headers.has('authorization')).toBe(false)
  })

  it('throws ModelUnavailableError on a non-2xx response', async () => {
    const model = createOpenAiCompatibleModel({
      baseUrl: 'https://llm.example.test',
      model: 'm',
      fetch: async () => new Response('rate limited', { status: 429 }),
    })
    await expect(model.complete([])).rejects.toBeInstanceOf(ModelUnavailableError)
  })

  it('throws ModelUnavailableError when the request itself fails or times out', async () => {
    const model = createOpenAiCompatibleModel({
      baseUrl: 'https://llm.example.test',
      model: 'm',
      fetch: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      },
    })
    await expect(model.complete([])).rejects.toBeInstanceOf(ModelUnavailableError)
  })

  it('throws ModelOutputError when the response has no message text', async () => {
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://llm.example.test', model: 'm', fetch: async () => ok(null) })
    await expect(model.complete([])).rejects.toBeInstanceOf(ModelOutputError)
    const notJson = createOpenAiCompatibleModel({
      baseUrl: 'https://llm.example.test',
      model: 'm',
      fetch: async () => new Response('<html>oops</html>', { status: 200 }),
    })
    await expect(notJson.complete([])).rejects.toBeInstanceOf(ModelOutputError)
  })
})

describe('modelConfigFromEnv', () => {
  it('uses Gemini’s OpenAI-compatible endpoint and the default free model when only GOOGLE_API_KEY is set', () => {
    const key = fakeKey()
    expect(modelConfigFromEnv({ GOOGLE_API_KEY: key })).toEqual({ baseUrl: GEMINI_OPENAI_BASE_URL, apiKey: key, model: DEFAULT_GEMINI_MODEL })
  })

  it('lets LLM_MODEL pick the Gemini model', () => {
    expect(modelConfigFromEnv({ GOOGLE_API_KEY: fakeKey(), LLM_MODEL: 'gemini-2.5-flash' })?.model).toBe('gemini-2.5-flash')
  })

  it('prefers an explicit OpenAI-compatible endpoint (LiteLLM, Ollama) when LLM_BASE_URL and LLM_MODEL are set', () => {
    const key = fakeKey()
    const config = modelConfigFromEnv({ GOOGLE_API_KEY: fakeKey(), LLM_BASE_URL: 'http://localhost:4000', LLM_MODEL: 'free', LLM_API_KEY: key })
    expect(config).toEqual({ baseUrl: 'http://localhost:4000', apiKey: key, model: 'free' })
  })

  it('returns null when LLM_BASE_URL is set without LLM_MODEL, or when nothing is set', () => {
    expect(modelConfigFromEnv({ LLM_BASE_URL: 'http://localhost:4000' })).toBeNull()
    expect(modelConfigFromEnv({})).toBeNull()
    expect(modelConfigFromEnv({ GOOGLE_API_KEY: '' })).toBeNull()
  })
})
