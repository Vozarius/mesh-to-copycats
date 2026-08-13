import type { Aabb16 } from '@mesh-to-copycats/shared';
import {
  MaterialCompatibility,
  ShapeFamily,
} from '@mesh-to-copycats/shared';

export type ShapeStateValue = boolean | number | string;
export type ShapeState = Readonly<Record<string, ShapeStateValue>>;

export interface ShapePartDefinition {
  readonly boxes: readonly Aabb16[];
  readonly compatibility?: number;
  readonly key: string;
  readonly materialSlot: number;
}

export interface ShapeDefinitionInput {
  readonly blockId: string;
  readonly boxes: readonly Aabb16[];
  readonly complexity: number;
  readonly family: ShapeFamily;
  readonly familyPriority?: number;
  readonly neighborDependent?: boolean;
  readonly parts?: readonly ShapePartDefinition[];
  readonly routeKeys?: readonly string[];
  readonly stableId?: string;
  readonly state: ShapeState;
}

export interface ShapeMetadata {
  readonly blockId: string;
  readonly complexity: number;
  readonly family: ShapeFamily;
  readonly geometryId: number;
  readonly geometryKey: string;
  readonly neighborDependent: boolean;
  readonly shapeId: number;
  readonly state: string;
  readonly stateId: number;
}

export interface ShapePartMetadata {
  readonly compatibility: number;
  readonly key: string;
  readonly materialSlot: number;
  readonly partId: number;
}

export const DEFAULT_PART_COMPATIBILITY = MaterialCompatibility.GENERAL_COPYCAT;
