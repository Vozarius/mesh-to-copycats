const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_INT = 3;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;

export type NbtValue =
  | { readonly type: typeof TAG_BYTE; readonly value: number }
  | { readonly type: typeof TAG_INT; readonly value: number }
  | { readonly type: typeof TAG_STRING; readonly value: string }
  | { readonly type: typeof TAG_LIST; readonly elementType: number; readonly value: readonly NbtValue[] }
  | { readonly type: typeof TAG_COMPOUND; readonly value: Readonly<Record<string, NbtValue>> };

export const nbt = {
  byte(value: boolean | number): NbtValue {
    return { type: TAG_BYTE, value: typeof value === 'boolean' ? (value ? 1 : 0) : value };
  },
  compound(value: Readonly<Record<string, NbtValue>>): NbtValue {
    return { type: TAG_COMPOUND, value };
  },
  int(value: number): NbtValue {
    return { type: TAG_INT, value };
  },
  list(elementType: number, value: readonly NbtValue[]): NbtValue {
    return { elementType, type: TAG_LIST, value };
  },
  string(value: string): NbtValue {
    return { type: TAG_STRING, value };
  },
  tags: {
    compound: TAG_COMPOUND,
    int: TAG_INT,
  },
} as const;

class Writer {
  readonly #bytes: number[] = [];
  readonly #encoder = new TextEncoder();

  public byte(value: number): void {
    this.#bytes.push(value & 0xff);
  }

  public int(value: number): void {
    this.#bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  public string(value: string): void {
    const bytes = this.#encoder.encode(value);
    if (bytes.length > 0xffff) throw new RangeError('NBT string exceeds 65535 UTF-8 bytes');
    this.#bytes.push((bytes.length >>> 8) & 0xff, bytes.length & 0xff, ...bytes);
  }

  public value(tag: NbtValue): void {
    switch (tag.type) {
      case TAG_BYTE:
        this.byte(tag.value);
        return;
      case TAG_INT:
        this.int(tag.value);
        return;
      case TAG_STRING:
        this.string(tag.value);
        return;
      case TAG_LIST:
        this.byte(tag.elementType);
        this.int(tag.value.length);
        for (const item of tag.value) {
          if (item.type !== tag.elementType) throw new Error('NBT list contains a different tag type');
          this.value(item);
        }
        return;
      case TAG_COMPOUND:
        for (const [name, child] of Object.entries(tag.value)) {
          this.byte(child.type);
          this.string(name);
          this.value(child);
        }
        this.byte(TAG_END);
        return;
    }
  }

  public finish(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

export function encodeRootCompound(root: NbtValue): Uint8Array {
  if (root.type !== TAG_COMPOUND) throw new TypeError('NBT root must be a compound');
  const writer = new Writer();
  writer.byte(TAG_COMPOUND);
  writer.string('');
  writer.value(root);
  return writer.finish();
}
