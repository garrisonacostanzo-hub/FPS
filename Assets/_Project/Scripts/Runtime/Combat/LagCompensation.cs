using System;
using System.Collections.Generic;
using UnityEngine;

namespace FPS.Combat
{
    /// <summary>
    /// Server-side rewind helper ("favour the shooter" lag compensation for hitscan weapons).
    /// <code>
    /// using (LagCompensation.RewindScope(clientViewTime, shooterTarget)) { Physics.Raycast(...); }
    /// </code>
    /// </summary>
    public static class LagCompensation
    {
        private static readonly List<LagCompensatedTarget> s_Targets = new List<LagCompensatedTarget>(64);
        private static readonly List<LagCompensatedTarget> s_Rewound = new List<LagCompensatedTarget>(64);

        public static int TargetCount => s_Targets.Count;

        internal static void Register(LagCompensatedTarget target)
        {
            if (target != null && !s_Targets.Contains(target))
            {
                s_Targets.Add(target);
            }
        }

        internal static void Unregister(LagCompensatedTarget target)
        {
            s_Targets.Remove(target);
            s_Rewound.Remove(target);
        }

        /// <summary>Rewinds every registered target except <paramref name="exclude"/> to <paramref name="time"/>.</summary>
        public static void Rewind(double time, LagCompensatedTarget exclude)
        {
            Restore();
            for (int i = 0; i < s_Targets.Count; i++)
            {
                LagCompensatedTarget target = s_Targets[i];
                if (target == null || target == exclude || !target.isActiveAndEnabled)
                {
                    continue;
                }

                target.Rewind(time);
                s_Rewound.Add(target);
            }

            Physics.SyncTransforms();
        }

        public static void Restore()
        {
            if (s_Rewound.Count == 0)
            {
                return;
            }

            for (int i = 0; i < s_Rewound.Count; i++)
            {
                if (s_Rewound[i] != null)
                {
                    s_Rewound[i].Restore();
                }
            }

            s_Rewound.Clear();
            Physics.SyncTransforms();
        }

        public static Scope RewindScope(double time, LagCompensatedTarget exclude)
        {
            Rewind(time, exclude);
            return new Scope();
        }

        public readonly struct Scope : IDisposable
        {
            public void Dispose()
            {
                Restore();
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_Targets.Clear();
            s_Rewound.Clear();
        }
    }
}
