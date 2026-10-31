using UnityEngine;

namespace FPS.Data
{
    /// <summary>
    /// Tunable bot skill profile. All AI subsystems (perception, aim, tactics) read from this asset,
    /// so difficulty can be changed per match, per squad or per bot at runtime.
    /// </summary>
    [CreateAssetMenu(menuName = "FPS/Bot Difficulty Profile", fileName = "BotDifficulty", order = 10)]
    public class BotDifficultyProfile : ScriptableObject
    {
        public string displayName = "Normal";

        [Header("Reaction")]
        [Tooltip("Seconds between a target becoming fully detected and the first shot.")]
        [Range(0f, 2f)] public float reactionTime = 0.45f;
        [Tooltip("Seconds between tactical re-evaluations (lower = more responsive bots, more CPU).")]
        [Range(0.05f, 1.5f)] public float decisionInterval = 0.25f;

        [Header("Aim")]
        [Tooltip("0 = wild spray, 1 = laser accurate.")]
        [Range(0f, 1f)] public float aimAccuracy = 0.6f;
        [Tooltip("Maximum aim rotation speed in degrees per second.")]
        [Range(30f, 1440f)] public float aimTrackingSpeed = 260f;
        [Tooltip("Seconds of continuous tracking to reach best accuracy.")]
        [Range(0.05f, 3f)] public float aimSettleTime = 0.8f;
        [Range(0f, 1f)] public float headshotPreference = 0.15f;
        [Tooltip("Maximum aim error cone (degrees) at aimAccuracy = 0.")]
        [Range(0.5f, 20f)] public float maxAimErrorDegrees = 9f;

        [Header("Perception")]
        [Range(10f, 400f)] public float detectionDistance = 85f;
        [Range(30f, 180f)] public float fieldOfView = 110f;
        [Tooltip("Seconds of visibility needed to fully detect a target at max distance.")]
        [Range(0.05f, 3f)] public float detectionTime = 0.9f;
        [Range(0f, 3f)] public float hearingMultiplier = 1f;
        [Tooltip("Seconds a bot remembers the last known position of a lost target.")]
        [Range(1f, 30f)] public float memoryDuration = 9f;

        [Header("Tactics")]
        [Tooltip("0 = cautious (cover, long range), 1 = aggressive (push, flank, short range).")]
        [Range(0f, 1f)] public float aggressiveness = 0.5f;
        [Range(0f, 1f)] public float flankChance = 0.35f;
        [Tooltip("Health fraction under which the bot prioritises cover.")]
        [Range(0f, 1f)] public float retreatHealthFraction = 0.4f;
        [Tooltip("Suppression (0..1) above which the bot looks for cover.")]
        [Range(0.05f, 1f)] public float suppressionTolerance = 0.45f;
        [Range(0f, 1f)] public float strafeChance = 0.6f;
        [Tooltip("Magazine fraction under which the bot reloads when it feels safe.")]
        [Range(0f, 1f)] public float tacticalReloadFraction = 0.35f;

        [Header("Trigger discipline")]
        public Vector2 burstShots = new Vector2(3f, 7f);
        public Vector2 burstPause = new Vector2(0.15f, 0.45f);

        /// <summary>Aim error cone in degrees for the current settle progress (0..1).</summary>
        public float GetAimError(float settleProgress, float situationalMultiplier)
        {
            float baseError = Mathf.Lerp(maxAimErrorDegrees, maxAimErrorDegrees * 0.06f, aimAccuracy);
            float settled = Mathf.Lerp(baseError * 2.2f, baseError, Mathf.Clamp01(settleProgress));
            return settled * Mathf.Max(0.1f, situationalMultiplier);
        }
    }
}
