/** fetch() chunks need not end at message boundaries; keep incomplete frames. */
export function createEventParser(onData: (value: unknown) => void) {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) onData(JSON.parse(data));
    }
  };
}
