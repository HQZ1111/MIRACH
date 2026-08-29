Mirach 便携版 — 使用说明
==========================

一、启动
  双击 Mirach.exe（Windows 10/11，一般自带 WebView2；若提示缺失，
  安装 Microsoft Edge WebView2 Runtime 后重试）。

二、配置模型（首次必做）
  应用内：设置 → 模型配置，填入你自己的 API Base URL 与 API Key。
  软件本身不内置任何密钥；数据只保存在本机。

三、目录结构
  runtime/node              便携 Node.js（引擎运行时依赖，勿删）
  runtime/agent-sidecar     引擎桥接服务（勿删）
  runtime/deepseek-harness  dsh 引擎（勿删）

四、注意事项
  解压路径不要包含中文或空格可减少意外问题（非强制）。
  会话数据保存在 C:\Users\<你>\.hermes\dsh-sessions\，删除该目录即可清空。
