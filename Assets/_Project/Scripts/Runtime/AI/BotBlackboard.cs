using FPS.Combat;
using UnityEngine;

namespace FPS.AI
{
    /// <summary>Per-bot working memory shared between perception, the decision layer and the states.</summary>
    public class BotBlackboard
    {
        public Combatant Target;
        public bool TargetVisible;
        public Vector3 LastKnownTargetPosition;
        public Vector3 LastKnownTargetVelocity;
        public float LastSeenTime = -999f;
        public float TargetAcquiredTime = -999f;
        public float TargetAwareness;

        public bool HasInvestigatePosition;
        public Vector3 InvestigatePosition;
        public float InvestigateTime = -999f;
        public NoiseType InvestigateReason;

        public float Suppression;
        public Vector3 ThreatPosition;
        public float LastThreatTime = -999f;
        public Combatant LastAttacker;
        public float LastDamagedTime = -999f;

        public CoverPoint CurrentCover;
        public float LastCoverTime = -999f;
        public bool ReloadInCover;

        public bool FlankAssigned;
        public Vector3 FlankPosition;

        public float TimeSinceSeen => Time.time - LastSeenTime;
        public float TimeSinceDamaged => Time.time - LastDamagedTime;
        public float TimeSinceThreat => Time.time - LastThreatTime;
        public bool HasTarget => Target != null && Target.IsAlive;

        public Vector3 BestThreatPosition
        {
            get
            {
                if (HasTarget && TimeSinceSeen < 6f)
                {
                    return TargetVisible ? Target.FeetPosition : LastKnownTargetPosition;
                }

                return TimeSinceThreat < 6f ? ThreatPosition : LastKnownTargetPosition;
            }
        }

        public void ForgetTarget()
        {
            Target = null;
            TargetVisible = false;
            TargetAwareness = 0f;
            FlankAssigned = false;
        }

        public void SetInvestigate(Vector3 position, NoiseType reason)
        {
            HasInvestigatePosition = true;
            InvestigatePosition = position;
            InvestigateTime = Time.time;
            InvestigateReason = reason;
        }

        public void Reset()
        {
            ForgetTarget();
            HasInvestigatePosition = false;
            Suppression = 0f;
            LastSeenTime = -999f;
            LastDamagedTime = -999f;
            LastThreatTime = -999f;
            LastAttacker = null;
            CurrentCover = null;
            ReloadInCover = false;
        }
    }
}
