declare type LiteralUnion<T extends U, U = string> = import('type-fest').LiteralUnion<T, U>;
declare type PartialDeep<T> = import('type-fest').PartialDeep<T>;
declare type SetRequired<BaseType, Keys extends keyof BaseType> = import('type-fest').SetRequired<BaseType, Keys>;
