// _fake-ssh.cs — 远程引擎（SSH）集成测试替身。
//
// 编译成 ssh.exe 并把所在目录放到 PATH 前面，mirach 的远程分支就会调用它：
// 它丢弃 ssh 选项（-T/-p/-i/-o）与目标主机，把剩余部分（"<node> <sidecar>"）
// 交给 cmd 执行，并在本地 stdin/stdout 与子进程之间双向转发字节。
// 于是"远程 sidecar"在本地被真实拉起，协议链路（JSONL over 子进程 stdio）
// 与真实 SSH 完全一致；只有 SSH 传输本身与远端 OS 由真实主机提供。
//
// 编译：csc /nologo /out:ssh.exe _fake-ssh.cs
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal static class FakeSsh
{
    private static int Main(string[] raw)
    {
        var rest = new List<string>();
        int i = 0;
        for (; i < raw.Length; i++)
        {
            var a = raw[i];
            if (a == "-T") continue;
            if (a == "-p" || a == "-i" || a == "-o" || a == "-l") { i++; continue; }
            break; // 到这里是 host
        }
        i++; // 跳过 host
        for (; i < raw.Length; i++) rest.Add(raw[i]);
        var remote = string.Join(" ", rest.ToArray());
        Console.Error.WriteLine("[fake-ssh] remote cmd: " + remote);
        Console.Error.Flush();

        var psi = new ProcessStartInfo("cmd.exe", "/c " + remote)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        var child = Process.Start(psi);
        if (child == null)
        {
            Console.Error.WriteLine("[fake-ssh] failed to start remote command");
            return 127;
        }

        var inTask = Task.Run(() =>
        {
            try
            {
                var src = Console.OpenStandardInput();
                var dst = child.StandardInput.BaseStream;
                var buf = new byte[16384];
                int n;
                while ((n = src.Read(buf, 0, buf.Length)) > 0)
                {
                    dst.Write(buf, 0, n);
                    dst.Flush();
                }
            }
            catch { /* 本地端先关闭 */ }
            finally
            {
                try { child.StandardInput.BaseStream.Close(); } catch { }
            }
        });
        var outTask = Task.Run(() =>
        {
            try
            {
                var src = child.StandardOutput.BaseStream;
                var dst = Console.OpenStandardOutput();
                var buf = new byte[16384];
                int n;
                while ((n = src.Read(buf, 0, buf.Length)) > 0)
                {
                    dst.Write(buf, 0, n);
                    dst.Flush();
                }
            }
            catch { }
        });
        var errTask = Task.Run(() =>
        {
            try
            {
                var src = child.StandardError.BaseStream;
                var dst = Console.OpenStandardError();
                var buf = new byte[16384];
                int n;
                while ((n = src.Read(buf, 0, buf.Length)) > 0)
                {
                    dst.Write(buf, 0, n);
                    dst.Flush();
                }
            }
            catch { }
        });

        child.WaitForExit();
        Task.WaitAll(new[] { inTask, outTask, errTask }, 3000);
        return child.ExitCode;
    }
}
