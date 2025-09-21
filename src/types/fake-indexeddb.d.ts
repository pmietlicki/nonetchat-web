declare module 'fake-indexeddb/lib/FDBFactory' {
  import type { IDBFactory } from 'fake-indexeddb';

  export default class FDBFactory implements IDBFactory {}
}

declare module 'fake-indexeddb/lib/FDBKeyRange' {
  import type { IDBKeyRange } from 'fake-indexeddb';

  const FDBKeyRange: IDBKeyRange;
  export default FDBKeyRange;
}
