using UnityEngine;

namespace FPS.Data
{
    /// <summary>Rules of a match. The host can override bot count and difficulty from the main menu.</summary>
    [CreateAssetMenu(menuName = "FPS/Match Settings", fileName = "MatchSettings", order = 30)]
    public class MatchSettings : ScriptableObject
    {
        [Header("Session")]
        [Range(2, 32)] public int maxHumanPlayers = 16;
        [Range(0, 31)] public int defaultBotCount = 7;
        [Range(10, 120)] public int networkTickRate = 60;
        public string gameVersion = "0.1.0";

        [Header("Flow")]
        [Min(0f)] public float warmupDuration = 8f;
        [Min(30f)] public float matchDuration = 600f;
        [Min(0f)] public float postMatchDuration = 12f;
        [Min(50)] public int scoreLimit = 1000;

        [Header("Respawn")]
        [Min(0.5f)] public float respawnDelay = 4f;
        [Min(0f)] public float spawnProtection = 1.5f;

        [Header("Scoring")]
        [Min(0)] public int killScore = 10;
        [Min(0)] public int headshotBonus = 5;
        [Min(0)] public int captureScore = 25;
        [Tooltip("Team points awarded per owned capture zone every scoring interval.")]
        [Min(0)] public int zoneTickPoints = 2;
        [Min(0.25f)] public float zoneTickInterval = 2f;

        [Header("Capture zones")]
        [Min(1f)] public float captureTime = 9f;
        [Min(0.1f)] public float maxCaptureSpeedMultiplier = 2.5f;

        [Header("Combat rules")]
        public bool friendlyFire;
        [Min(0f)] public float healthRegenDelay = 5f;
        [Min(0f)] public float healthRegenPerSecond = 18f;

        [Header("Lag compensation")]
        [Range(0f, 1f)] public float maxRewindSeconds = 0.3f;
        [Range(0f, 0.3f)] public float remoteInterpolationDelay = 0.1f;
    }
}
