using UnityEngine;

namespace FPS.Combat
{
    /// <summary>
    /// Server-side pose history of a character's hitboxes. Every server tick the owning gameplay script calls
    /// <see cref="Record"/>; when a client's shot is validated, <see cref="LagCompensation"/> rewinds every target
    /// to the moment the shooter actually saw on screen, performs the raycast and restores the present.
    /// </summary>
    [DisallowMultipleComponent]
    public class LagCompensatedTarget : MonoBehaviour
    {
        private const int k_HistoryLength = 72; // ~1.2 s at 60 Hz

        private struct Frame
        {
            public double Time;
            public Vector3[] Positions;
            public Quaternion[] Rotations;
        }

        [SerializeField] private HitboxRig m_Rig;

        private Transform[] m_Transforms;
        private Frame[] m_Frames;
        private int m_Head;
        private int m_Count;
        private Vector3[] m_SavedPositions;
        private Quaternion[] m_SavedRotations;
        private bool m_IsRewound;

        public bool IsRewound => m_IsRewound;

        private void Awake()
        {
            if (m_Rig == null)
            {
                m_Rig = GetComponentInChildren<HitboxRig>(true);
            }

            Hitbox[] hitboxes = GetComponentsInChildren<Hitbox>(true);
            m_Transforms = new Transform[hitboxes.Length];
            for (int i = 0; i < hitboxes.Length; i++)
            {
                m_Transforms[i] = hitboxes[i].transform;
            }

            m_Frames = new Frame[k_HistoryLength];
            for (int i = 0; i < k_HistoryLength; i++)
            {
                m_Frames[i] = new Frame
                {
                    Positions = new Vector3[m_Transforms.Length],
                    Rotations = new Quaternion[m_Transforms.Length]
                };
            }

            m_SavedPositions = new Vector3[m_Transforms.Length];
            m_SavedRotations = new Quaternion[m_Transforms.Length];
        }

        private void OnEnable()
        {
            LagCompensation.Register(this);
        }

        private void OnDisable()
        {
            LagCompensation.Unregister(this);
        }

        public void ClearHistory()
        {
            m_Count = 0;
            m_Head = 0;
        }

        /// <summary>Stores the current hitbox poses stamped with the given server time.</summary>
        public void Record(double serverTime)
        {
            if (m_Transforms == null || m_Transforms.Length == 0 || m_IsRewound)
            {
                return;
            }

            ref Frame frame = ref m_Frames[m_Head];
            frame.Time = serverTime;
            for (int i = 0; i < m_Transforms.Length; i++)
            {
                frame.Positions[i] = m_Transforms[i].position;
                frame.Rotations[i] = m_Transforms[i].rotation;
            }

            m_Head = (m_Head + 1) % k_HistoryLength;
            m_Count = Mathf.Min(m_Count + 1, k_HistoryLength);
        }

        internal void Rewind(double time)
        {
            if (m_IsRewound || m_Count == 0)
            {
                return;
            }

            for (int i = 0; i < m_Transforms.Length; i++)
            {
                m_SavedPositions[i] = m_Transforms[i].position;
                m_SavedRotations[i] = m_Transforms[i].rotation;
            }

            // Find the two frames around the requested time (newest first).
            int newest = (m_Head - 1 + k_HistoryLength) % k_HistoryLength;
            int older = newest;
            int newer = newest;
            for (int n = 0; n < m_Count; n++)
            {
                int index = (newest - n + k_HistoryLength) % k_HistoryLength;
                if (m_Frames[index].Time <= time)
                {
                    older = index;
                    break;
                }

                newer = index;
                older = index;
            }

            Frame a = m_Frames[older];
            Frame b = m_Frames[newer];
            double span = b.Time - a.Time;
            float t = span > 1e-6 ? Mathf.Clamp01((float)((time - a.Time) / span)) : 0f;

            for (int i = 0; i < m_Transforms.Length; i++)
            {
                m_Transforms[i].SetPositionAndRotation(
                    Vector3.Lerp(a.Positions[i], b.Positions[i], t),
                    Quaternion.Slerp(a.Rotations[i], b.Rotations[i], t));
            }

            m_IsRewound = true;
        }

        internal void Restore()
        {
            if (!m_IsRewound)
            {
                return;
            }

            for (int i = 0; i < m_Transforms.Length; i++)
            {
                m_Transforms[i].SetPositionAndRotation(m_SavedPositions[i], m_SavedRotations[i]);
            }

            m_IsRewound = false;
        }
    }
}
