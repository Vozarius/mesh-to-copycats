import type { Resolution } from '@mesh-to-copycats/shared';

import {
  maskFromHex,
  maskFromPredicate,
  resampleMaskNearest,
  validateMask,
  type OccupancyPredicate,
} from './mask.js';

export type MaskProvider = () => Uint32Array;

export interface TargetOccupancy {
  estimatedBytes(): number;
  getMask(resolution: Resolution): Uint32Array;
  isMaterialized(resolution: Resolution): boolean;
  materializedResolutions(): Resolution[];
}

export class AdaptiveOccupancy implements TargetOccupancy {
  readonly #mask4: Uint32Array;
  #mask8: Uint32Array | undefined;
  #mask16: Uint32Array | undefined;
  readonly #provider8: MaskProvider | undefined;
  readonly #provider16: MaskProvider | undefined;

  public constructor(
    mask4: Uint32Array,
    provider8?: MaskProvider,
    provider16?: MaskProvider,
  ) {
    validateMask(mask4, 4);
    this.#mask4 = mask4;
    this.#provider8 = provider8;
    this.#provider16 = provider16;
  }

  public static fromPredicate(predicate: OccupancyPredicate): AdaptiveOccupancy {
    return new AdaptiveOccupancy(
      maskFromPredicate(4, predicate),
      () => maskFromPredicate(8, predicate),
      () => maskFromPredicate(16, predicate),
    );
  }

  public static fromMask16(mask16: Uint32Array): AdaptiveOccupancy {
    validateMask(mask16, 16);
    const mask4 = resampleMaskNearest(mask16, 16, 4);
    return new AdaptiveOccupancy(
      mask4,
      () => resampleMaskNearest(mask16, 16, 8),
      () => mask16,
    );
  }

  public static fromHex16(hex: string): AdaptiveOccupancy {
    return AdaptiveOccupancy.fromMask16(maskFromHex(hex, 16));
  }

  public getMask(resolution: Resolution): Uint32Array {
    if (resolution === 4) return this.#mask4;
    if (resolution === 8) {
      if (this.#mask8 === undefined) {
        if (this.#provider8 === undefined) {
          throw new Error('No 8³ occupancy provider was supplied');
        }
        const mask = this.#provider8();
        validateMask(mask, 8);
        this.#mask8 = mask;
      }
      return this.#mask8;
    }
    if (this.#mask16 === undefined) {
      if (this.#provider16 === undefined) {
        throw new Error('No 16³ occupancy provider was supplied');
      }
      const mask = this.#provider16();
      validateMask(mask, 16);
      this.#mask16 = mask;
    }
    return this.#mask16;
  }

  public isMaterialized(resolution: Resolution): boolean {
    if (resolution === 4) return true;
    return resolution === 8 ? this.#mask8 !== undefined : this.#mask16 !== undefined;
  }

  public materializedResolutions(): Resolution[] {
    const result: Resolution[] = [4];
    if (this.#mask8 !== undefined) result.push(8);
    if (this.#mask16 !== undefined) result.push(16);
    return result;
  }

  public estimatedBytes(): number {
    return (
      this.#mask4.byteLength +
      (this.#mask8?.byteLength ?? 0) +
      (this.#mask16?.byteLength ?? 0)
    );
  }
}
