declare module 'lru-cache' {
  interface LRUCacheOptions<K, V> {
    max: number
    ttl?: number
  }

  class LRUCache<K, V> {
    constructor(options: LRUCacheOptions<K, V>)
    get(key: K): V | undefined
    set(key: K, value: V): void
    has(key: K): boolean
    delete(key: K): boolean
    clear(): void
    get size(): number
  }

  export default LRUCache
}
