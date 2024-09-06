import { parseChallenge, isValidChallenge } from './utils'

describe('parseChallenge', () => {
  it('should parse a valid challenge string', () => {
    const challenge =
      'Bearer realm="https://auth.example.com",service="example-service",scope="read:packages"'
    const result = parseChallenge(challenge)

    expect(result.size).toBe(3)
    expect(result.get('realm')).toBe('https://auth.example.com')
    expect(result.get('service')).toBe('example-service')
    expect(result.get('scope')).toBe('read:packages')
  })

  it('should handle a challenge string without Bearer prefix', () => {
    const challenge =
      'realm="https://auth.example.com",service="example-service",scope="read:packages"'
    const result = parseChallenge(challenge)

    expect(result.size).toBe(0)
  })

  it('should handle an empty challenge string', () => {
    const challenge = ''
    const result = parseChallenge(challenge)

    expect(result.size).toBe(0)
  })

  it('should handle a challenge string with extra spaces', () => {
    const challenge =
      'Bearer realm="https://auth.example.com", service="example-service", scope="read:packages"'
    const result = parseChallenge(challenge)

    expect(result.size).toBe(3)
    expect(result.get('realm')).toBe('https://auth.example.com')
    expect(result.get('service')).toBe('example-service')
    expect(result.get('scope')).toBe('read:packages')
  })

  it('should handle a challenge string with unquoted values', () => {
    const challenge =
      'Bearer realm=https://auth.example.com,service=example-service,scope=read:packages'
    const result = parseChallenge(challenge)

    expect(result.size).toBe(3)
    expect(result.get('realm')).toBe('https://auth.example.com')
    expect(result.get('service')).toBe('example-service')
    expect(result.get('scope')).toBe('read:packages')
  })
})

describe('isValidChallenge', () => {
  it('should return true for a valid challenge with all required attributes', () => {
    const attributes = new Map([
      ['realm', 'https://auth.example.com'],
      ['service', 'example-service'],
      ['scope', 'read:packages']
    ])
    expect(isValidChallenge(attributes)).toBe(true)
  })

  it('should return false if realm is missing', () => {
    const attributes = new Map([
      ['service', 'example-service'],
      ['scope', 'read:packages']
    ])
    expect(isValidChallenge(attributes)).toBe(false)
  })

  it('should return false if service is missing', () => {
    const attributes = new Map([
      ['realm', 'https://auth.example.com'],
      ['scope', 'read:packages']
    ])
    expect(isValidChallenge(attributes)).toBe(false)
  })

  it('should return false if scope is missing', () => {
    const attributes = new Map([
      ['realm', 'https://auth.example.com'],
      ['service', 'example-service']
    ])
    expect(isValidChallenge(attributes)).toBe(false)
  })

  it('should return false for an empty attributes map', () => {
    const attributes = new Map()
    expect(isValidChallenge(attributes)).toBe(false)
  })

  it('should return true even if there are additional attributes', () => {
    const attributes = new Map([
      ['realm', 'https://auth.example.com'],
      ['service', 'example-service'],
      ['scope', 'read:packages'],
      ['extra', 'not-needed']
    ])
    expect(isValidChallenge(attributes)).toBe(true)
  })
})
