/**
 * dsh-pocket 插件 client bundle 的模块声明：
 * vite 别名指向 ~/.mirach/dsh-plugins 下的 client/client.js（side-effect
 * 导入，经 __ModuleLoader__ shim 注册工厂），TS 无类型 → 空声明放行。
 */
declare module "dsh-pocket/client";
