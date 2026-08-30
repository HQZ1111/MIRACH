/**
 * agent-sidecar adapter 的类型边界声明：内核经 vite alias 复用 sidecar 的
 * adapter 源文件（运行时 vite 打包无碍），但该文件依赖 node 类型与 sidecar
 * 的宽松 tsconfig——非相对说明符 + 环境模块声明把类型检查挡在边界外。
 */
declare module "dsh-sidecar-adapter" {
  export interface DshAdapterHandle {
    handle(ev: { type: string; seq: number; time: number; data: unknown }): void;
    resetTurn(): void;
  }
  export function createDshAdapter(opts: {
    emit: (evt: unknown) => void;
    emitQueue: () => void;
    provider: string;
    model: string;
  }): DshAdapterHandle;
}
