/** One producer, one retained query consumer. Closing releases pending readers. */
export class InputQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private reader?: (result: IteratorResult<T>) => void;
  private ended = false;
  push(item: T) {
    if (this.ended) throw new Error('Input is closed.');
    if (this.reader) {
      const reader = this.reader;
      this.reader = undefined;
      reader({ value: item, done: false });
    } else this.items.push(item);
  }
  close() {
    this.ended = true;
    this.items = [];
    this.reader?.({ value: undefined, done: true });
    this.reader = undefined;
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.reader = resolve;
        });
      },
      return: async () => {
        this.close();
        return { value: undefined, done: true };
      },
    };
  }
}
