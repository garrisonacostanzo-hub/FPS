using System.Collections.Generic;
using FPS.Combat;
using FPS.Core;
using FPS.Data;
using UnityEngine;

namespace FPS.AI
{
    /// <summary>
    /// Server-side senses of a bot.
    ///  * Vision: view cone + distance + multi-point line-of-sight raycasts. Visibility builds an awareness meter per
    ///    enemy (faster when close, centred, moving or shooting) so detection is gradual and fair.
    ///  * Hearing: footsteps / gunfire / impacts published by <see cref="NoiseSystem"/>, attenuated by walls.
    ///  * Threat: near misses and damage raise suppression and reveal the shooter's rough position.
    /// Results are written to the bot's <see cref="BotBlackboard"/> and shared with its squad.
    /// </summary>
    public class BotPerception : MonoBehaviour
    {
        [SerializeField] private Transform m_Eye;
        [SerializeField] private bool m_DrawGizmos = true;

        private readonly Dictionary<ulong, float> m_Awareness = new Dictionary<ulong, float>(16);
        private readonly List<Combatant> m_Hostiles = new List<Combatant>(32);
        private readonly List<ulong> m_KeysScratch = new List<ulong>(16);

        private Combatant m_Self;
        private BotBlackboard m_Memory;
        private BotDifficultyProfile m_Difficulty;
        private BotSquad m_Squad;
        private bool m_Listening;

        public Vector3 EyePosition => m_Eye != null ? m_Eye.position : transform.position + Vector3.up * 1.6f;
        public float DetectionDistance => m_Difficulty != null ? m_Difficulty.detectionDistance : 80f;
        public float FieldOfView => m_Difficulty != null ? m_Difficulty.fieldOfView : 110f;

        public void Initialize(Combatant self, BotBlackboard memory, BotDifficultyProfile difficulty, Transform eye)
        {
            m_Self = self;
            m_Memory = memory;
            m_Difficulty = difficulty;
            if (eye != null)
            {
                m_Eye = eye;
            }
        }

        public void SetSquad(BotSquad squad)
        {
            m_Squad = squad;
        }

        public void SetDifficulty(BotDifficultyProfile difficulty)
        {
            m_Difficulty = difficulty;
        }

        public void StartListening()
        {
            if (!m_Listening)
            {
                EventBus<NoiseEvent>.Subscribe(OnNoise);
                m_Listening = true;
            }
        }

        public void StopListening()
        {
            if (m_Listening)
            {
                EventBus<NoiseEvent>.Unsubscribe(OnNoise);
                m_Listening = false;
            }
        }

        private void OnDisable()
        {
            StopListening();
        }

        public void ResetAwareness()
        {
            m_Awareness.Clear();
        }

        /// <summary>Runs one perception update. Call at a fixed interval (e.g. 10 Hz) on the server.</summary>
        public void Tick(float deltaTime)
        {
            if (m_Self == null || m_Memory == null || m_Difficulty == null || !m_Self.IsAlive)
            {
                return;
            }

            Vector3 eye = EyePosition;
            Vector3 forward = transform.forward;
            float maxDistance = m_Difficulty.detectionDistance;
            float halfFov = m_Difficulty.fieldOfView * 0.5f;
            float now = Time.time;

            CombatantRegistry.GetHostiles(m_Self, m_Hostiles);

            // Decay awareness of everyone first; visible enemies are raised again below.
            m_KeysScratch.Clear();
            m_KeysScratch.AddRange(m_Awareness.Keys);
            for (int i = 0; i < m_KeysScratch.Count; i++)
            {
                ulong key = m_KeysScratch[i];
                m_Awareness[key] = Mathf.Max(0f, m_Awareness[key] - deltaTime * 0.35f);
            }

            Combatant best = null;
            float bestScore = float.MinValue;

            for (int i = 0; i < m_Hostiles.Count; i++)
            {
                Combatant enemy = m_Hostiles[i];
                Vector3 toEnemy = enemy.ChestPosition - eye;
                float distance = toEnemy.magnitude;

                bool recentlyFired = now - enemy.LastFireTime < 0.6f;
                float effectiveRange = recentlyFired ? maxDistance * 1.8f : maxDistance;
                if (distance > effectiveRange)
                {
                    continue;
                }

                float angle = Vector3.Angle(forward, toEnemy);
                bool proximity = distance < 3.5f;
                bool peripheral = angle <= halfFov + 25f && distance < maxDistance * 0.3f;
                if (angle > halfFov && !proximity && !peripheral && !recentlyFired)
                {
                    continue;
                }

                if (!HasLineOfSight(eye, enemy))
                {
                    continue;
                }

                // Awareness gain: closer, centred, moving and shooting targets are noticed faster.
                float distanceFactor = Mathf.Lerp(3.5f, 0.55f, distance / Mathf.Max(1f, maxDistance));
                float centreFactor = angle < halfFov * 0.35f ? 1.35f : angle > halfFov ? 0.45f : 1f;
                float motionFactor = enemy.Velocity.sqrMagnitude > 4f ? 1.3f : 0.85f;
                float fireFactor = recentlyFired ? 2.2f : 1f;
                float gain = deltaTime / Mathf.Max(0.05f, m_Difficulty.detectionTime) * distanceFactor * centreFactor * motionFactor * fireFactor;

                ulong id = enemy.CombatantId;
                m_Awareness.TryGetValue(id, out float awareness);
                awareness = Mathf.Min(1.5f, awareness + gain + deltaTime * 0.35f);
                m_Awareness[id] = awareness;

                if (awareness >= 1f)
                {
                    float score = 100f / Mathf.Max(1f, distance);
                    if (enemy == m_Memory.Target) score += 2.5f;
                    if (enemy == m_Memory.LastAttacker && m_Memory.TimeSinceDamaged < 4f) score += 4f;
                    if (enemy.Health != null) score += (1f - enemy.Health.Normalized) * 1.5f;
                    if (score > bestScore)
                    {
                        bestScore = score;
                        best = enemy;
                    }
                }
                else if (awareness > 0.35f)
                {
                    // Something caught the bot's eye: go and look.
                    m_Memory.SetInvestigate(enemy.FeetPosition, NoiseType.Footstep);
                }
            }

            if (best != null)
            {
                if (best != m_Memory.Target)
                {
                    m_Memory.TargetAcquiredTime = now;
                }

                m_Memory.Target = best;
                m_Memory.TargetVisible = true;
                m_Memory.TargetAwareness = 1f;
                m_Memory.LastKnownTargetPosition = best.FeetPosition;
                m_Memory.LastKnownTargetVelocity = best.Velocity;
                m_Memory.LastSeenTime = now;
                m_Squad?.ReportEnemy(best, best.FeetPosition);
            }
            else
            {
                m_Memory.TargetVisible = false;
                if (m_Memory.Target != null)
                {
                    bool forgotten = m_Memory.TimeSinceSeen > m_Difficulty.memoryDuration || !m_Memory.Target.IsAlive;
                    if (forgotten)
                    {
                        m_Memory.ForgetTarget();
                    }
                }
            }

            m_Memory.Suppression = Mathf.Max(0f, m_Memory.Suppression - deltaTime * 0.3f);
        }

        public bool HasLineOfSight(Vector3 eye, Combatant enemy)
        {
            return IsPointVisible(eye, enemy.HeadPosition, enemy) || IsPointVisible(eye, enemy.ChestPosition, enemy) ||
                   IsPointVisible(eye, enemy.FeetPosition + Vector3.up * 0.5f, enemy);
        }

        private bool IsPointVisible(Vector3 eye, Vector3 point, Combatant enemy)
        {
            Vector3 direction = point - eye;
            float distance = direction.magnitude;
            if (distance < 0.01f)
            {
                return true;
            }

            if (Physics.Raycast(eye, direction / distance, out RaycastHit hit, distance, GameLayers.VisionBlockMask, QueryTriggerInteraction.Ignore))
            {
                return hit.collider.transform.IsChildOf(enemy.transform);
            }

            return true;
        }

        private void OnNoise(NoiseEvent noise)
        {
            if (m_Self == null || m_Memory == null || m_Difficulty == null || !m_Self.IsAlive || noise.Source == m_Self)
            {
                return;
            }

            bool hostile = noise.Source != null && noise.Source.Team != m_Self.Team;
            bool allyCombat = !hostile && noise.Type == NoiseType.Gunfire;
            if (!hostile && !allyCombat)
            {
                return;
            }

            Vector3 eye = EyePosition;
            float distance = Vector3.Distance(eye, noise.Position);
            float radius = noise.Radius * m_Difficulty.hearingMultiplier;
            if (Physics.Linecast(eye, noise.Position + Vector3.up * 0.5f, GameLayers.VisionBlockMask, QueryTriggerInteraction.Ignore))
            {
                radius *= 0.6f; // Walls muffle sound.
            }

            if (distance > radius)
            {
                return;
            }

            if (allyCombat)
            {
                // Teammates fighting nearby: move to support unless already busy.
                if (!m_Memory.HasTarget && distance > 12f)
                {
                    m_Memory.SetInvestigate(noise.Position, NoiseType.Gunfire);
                }

                return;
            }

            // Localisation error grows with distance and shrinks for loud sounds.
            float error = distance * (noise.Type == NoiseType.Gunfire ? 0.06f : 0.12f);
            Vector2 offset = Random.insideUnitCircle * error;
            Vector3 estimate = noise.Position + new Vector3(offset.x, 0f, offset.y);

            if (!m_Memory.TargetVisible)
            {
                m_Memory.SetInvestigate(estimate, noise.Type);
            }

            if (noise.Source != null)
            {
                ulong id = noise.Source.CombatantId;
                m_Awareness.TryGetValue(id, out float awareness);
                float boost = noise.Type == NoiseType.Gunfire ? 0.45f : 0.2f;
                if (distance < radius * 0.35f)
                {
                    boost += 0.3f;
                }

                m_Awareness[id] = Mathf.Min(0.95f, awareness + boost);
            }
        }

        /// <summary>Called when a bullet passes close by or hits this bot.</summary>
        public void OnIncomingFire(Combatant shooter, Vector3 shotOrigin, float intensity)
        {
            if (m_Memory == null)
            {
                return;
            }

            m_Memory.Suppression = Mathf.Clamp01(m_Memory.Suppression + intensity * 0.35f);
            m_Memory.ThreatPosition = shotOrigin;
            m_Memory.LastThreatTime = Time.time;
            if (shooter != null)
            {
                m_Awareness.TryGetValue(shooter.CombatantId, out float awareness);
                m_Awareness[shooter.CombatantId] = Mathf.Min(1.2f, awareness + 0.5f * intensity + 0.2f);
                if (!m_Memory.TargetVisible)
                {
                    m_Memory.SetInvestigate(shotOrigin, NoiseType.Gunfire);
                }
            }
        }

        public void OnDamaged(in DamageInfo damage)
        {
            if (m_Memory == null)
            {
                return;
            }

            m_Memory.Suppression = Mathf.Clamp01(m_Memory.Suppression + 0.4f);
            m_Memory.LastDamagedTime = Time.time;
            m_Memory.ThreatPosition = damage.SourcePosition;
            m_Memory.LastThreatTime = Time.time;
            Combatant attacker = damage.HasAttacker ? CombatantRegistry.Find(damage.AttackerId) : null;
            if (attacker != null && attacker != m_Self)
            {
                m_Memory.LastAttacker = attacker;
                m_Awareness[attacker.CombatantId] = 1.2f;
                if (!m_Memory.TargetVisible)
                {
                    m_Memory.Target = attacker;
                    m_Memory.LastKnownTargetPosition = damage.SourcePosition;
                    m_Memory.LastSeenTime = Time.time - 0.5f;
                }
            }
        }

        private void OnDrawGizmosSelected()
        {
            if (!m_DrawGizmos)
            {
                return;
            }

            Vector3 eye = EyePosition;
            float distance = DetectionDistance;
            float halfFov = FieldOfView * 0.5f;
            Gizmos.color = new Color(1f, 0.85f, 0.2f, 0.6f);
            Vector3 left = Quaternion.Euler(0f, -halfFov, 0f) * transform.forward;
            Vector3 right = Quaternion.Euler(0f, halfFov, 0f) * transform.forward;
            Gizmos.DrawLine(eye, eye + left * distance);
            Gizmos.DrawLine(eye, eye + right * distance);
            Gizmos.DrawLine(eye + left * distance, eye + transform.forward * distance);
            Gizmos.DrawLine(eye + right * distance, eye + transform.forward * distance);

            if (m_Memory != null && m_Memory.HasTarget)
            {
                Gizmos.color = m_Memory.TargetVisible ? Color.red : new Color(1f, 0.5f, 0f);
                Gizmos.DrawLine(eye, m_Memory.TargetVisible ? m_Memory.Target.ChestPosition : m_Memory.LastKnownTargetPosition);
            }

            if (m_Memory != null && m_Memory.HasInvestigatePosition)
            {
                Gizmos.color = Color.cyan;
                Gizmos.DrawWireSphere(m_Memory.InvestigatePosition, 0.6f);
            }
        }
    }
}
