/** Explicit provider refusal, including a refusal after streamed partial text. */
export class ModelRefusalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelRefusalError'
  }
}
