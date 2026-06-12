export type ServiceEventListener<T> = (event: T) => void

/** 进程内极简事件发射器：用于让 main 进程监听 service 实现的业务变化（非 RPC）。 */
export class ServiceEvent<T> {
  private readonly listeners = new Set<ServiceEventListener<T>>()

  public on(listener: ServiceEventListener<T>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public emit(event: T): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
