/**
 * Parses a challenge string and returns a map of attributes.
 * @param challenge - The challenge string to parse.
 * @returns A map of attributes parsed from the challenge string.
 */
export function parseChallenge(challenge: string): Map<string, string> {
  const attributes = new Map<string, string>()
  if (challenge.startsWith('Bearer ')) {
    challenge = challenge.replace('Bearer ', '')
    const parts = challenge.split(',')
    for (const part of parts) {
      const values = part.trim().split('=')
      const key = values[0].trim()
      let value = values[1].trim()
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1)
      }
      attributes.set(key, value)
    }
  }
  return attributes
}

/**
 * Checks if a challenge is valid based on the provided attributes.
 * @param attributes - A map of attribute names and values.
 * @returns A boolean indicating whether the challenge is valid or not.
 */
export function isValidChallenge(attributes: Map<string, string>): boolean {
  let valid = false
  if (
    attributes.has('realm') &&
    attributes.has('service') &&
    attributes.has('scope')
  ) {
    valid = true
  }
  return valid
}
