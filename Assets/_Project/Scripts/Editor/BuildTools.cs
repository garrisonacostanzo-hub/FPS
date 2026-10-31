using System;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace FPS.EditorTools
{
    /// <summary>Player and dedicated-server build entry points (menu + command line).</summary>
    public static class BuildTools
    {
        private const string BuildRoot = "Builds";

        [MenuItem("FPS/Build/Windows Client", priority = 200)]
        public static void BuildWindowsClient() => BuildClient(BuildTarget.StandaloneWindows64, "Windows/ProjectVanguard.exe");

        [MenuItem("FPS/Build/Linux Client", priority = 201)]
        public static void BuildLinuxClient() => BuildClient(BuildTarget.StandaloneLinux64, "Linux/ProjectVanguard.x86_64");

        [MenuItem("FPS/Build/macOS Client", priority = 202)]
        public static void BuildMacClient() => BuildClient(BuildTarget.StandaloneOSX, "macOS/ProjectVanguard.app");

        [MenuItem("FPS/Build/Linux Dedicated Server", priority = 220)]
        public static void BuildLinuxServer() => BuildServer(BuildTarget.StandaloneLinux64, "LinuxServer/ProjectVanguardServer.x86_64");

        [MenuItem("FPS/Build/Windows Dedicated Server", priority = 221)]
        public static void BuildWindowsServer() => BuildServer(BuildTarget.StandaloneWindows64, "WindowsServer/ProjectVanguardServer.exe");

        /// <summary>Command line: -executeMethod FPS.EditorTools.BuildTools.BuildLinuxServerBatch</summary>
        public static void BuildLinuxServerBatch()
        {
            bool ok = BuildServer(BuildTarget.StandaloneLinux64, "LinuxServer/ProjectVanguardServer.x86_64");
            EditorApplication.Exit(ok ? 0 : 1);
        }

        /// <summary>Command line: -executeMethod FPS.EditorTools.BuildTools.BuildWindowsClientBatch</summary>
        public static void BuildWindowsClientBatch()
        {
            bool ok = BuildClient(BuildTarget.StandaloneWindows64, "Windows/ProjectVanguard.exe");
            EditorApplication.Exit(ok ? 0 : 1);
        }

        public static bool BuildClient(BuildTarget target, string relativePath)
        {
            var options = new BuildPlayerOptions
            {
                scenes = Scenes(),
                locationPathName = Path.Combine(BuildRoot, relativePath),
                target = target,
                targetGroup = BuildPipeline.GetBuildTargetGroup(target),
                options = BuildOptions.None
            };
            return Run(options);
        }

        public static bool BuildServer(BuildTarget target, string relativePath)
        {
            object boxed = new BuildPlayerOptions
            {
                scenes = Scenes(),
                locationPathName = Path.Combine(BuildRoot, relativePath),
                target = target,
                targetGroup = BuildPipeline.GetBuildTargetGroup(target),
                options = BuildOptions.None
            };

            // BuildPlayerOptions.subtarget = StandaloneBuildSubtarget.Server (set by reflection to stay version-agnostic).
            Type subtargetEnum = typeof(BuildPlayerOptions).Assembly.GetType("UnityEditor.StandaloneBuildSubtarget");
            int serverValue = subtargetEnum != null ? Convert.ToInt32(Enum.Parse(subtargetEnum, "Server")) : 2;
            PropertyInfo property = typeof(BuildPlayerOptions).GetProperty("subtarget", BindingFlags.Public | BindingFlags.Instance);
            FieldInfo field = typeof(BuildPlayerOptions).GetField("subtarget", BindingFlags.Public | BindingFlags.Instance)
                              ?? typeof(BuildPlayerOptions).GetField("m_Subtarget", BindingFlags.NonPublic | BindingFlags.Instance);
            if (property != null && property.CanWrite)
            {
                property.SetValue(boxed, serverValue);
            }
            else if (field != null)
            {
                field.SetValue(boxed, serverValue);
            }
            else
            {
                Debug.LogWarning("[FPS Build] Dedicated server subtarget not available; building a regular player (run it with -batchmode -nographics -server).");
            }

            return Run((BuildPlayerOptions)boxed);
        }

        private static string[] Scenes()
        {
            string[] scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
            if (scenes.Length == 0)
            {
                SceneFactory.RegisterBuildScenes();
                scenes = EditorBuildSettings.scenes.Select(s => s.path).ToArray();
            }

            return scenes;
        }

        private static bool Run(BuildPlayerOptions options)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(options.locationPathName) ?? BuildRoot);
            BuildReport report = BuildPipeline.BuildPlayer(options);
            bool success = report.summary.result == BuildResult.Succeeded;
            Debug.Log($"[FPS Build] {options.target} -> {options.locationPathName}: {report.summary.result} ({report.summary.totalSize / (1024 * 1024)} MB, {report.summary.totalTime})");
            return success;
        }
    }
}
