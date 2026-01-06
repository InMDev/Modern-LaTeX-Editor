export async function compile() {
  // Throwing a non-Error exercises the `String(e)` fallback in the host wrapper.
  throw 'Boom string';
}

