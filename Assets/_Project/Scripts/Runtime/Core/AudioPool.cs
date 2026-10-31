using System.Collections.Generic;
using UnityEngine;

namespace FPS.Core
{
    /// <summary>Pooled positional one-shot audio sources (avoids AudioSource.PlayClipAtPoint garbage).</summary>
    public class AudioPool : MonoBehaviour
    {
        private const int k_PoolSize = 32;
        private static AudioPool s_Instance;
        private readonly List<AudioSource> m_Sources = new List<AudioSource>(k_PoolSize);
        private int m_Next;

        public static bool IsAvailable => !Application.isBatchMode;

        private static AudioPool Instance
        {
            get
            {
                if (s_Instance == null)
                {
                    var go = new GameObject("[AudioPool]");
                    DontDestroyOnLoad(go);
                    s_Instance = go.AddComponent<AudioPool>();
                }

                return s_Instance;
            }
        }

        public static void PlayAt(AudioClip clip, Vector3 position, float volume = 1f, float pitch = 1f, float spatialBlend = 1f, float maxDistance = 120f)
        {
            if (clip == null || !IsAvailable)
            {
                return;
            }

            AudioSource source = Instance.NextSource();
            source.transform.position = position;
            source.clip = clip;
            source.volume = volume;
            source.pitch = pitch;
            source.spatialBlend = spatialBlend;
            source.maxDistance = maxDistance;
            source.Play();
        }

        public static void Play2D(AudioClip clip, float volume = 1f, float pitch = 1f)
        {
            PlayAt(clip, Vector3.zero, volume, pitch, 0f);
        }

        private AudioSource NextSource()
        {
            if (m_Sources.Count < k_PoolSize)
            {
                var child = new GameObject("Source" + m_Sources.Count);
                child.transform.SetParent(transform, false);
                var source = child.AddComponent<AudioSource>();
                source.playOnAwake = false;
                source.rolloffMode = AudioRolloffMode.Linear;
                source.minDistance = 2f;
                source.dopplerLevel = 0f;
                m_Sources.Add(source);
                return source;
            }

            AudioSource next = m_Sources[m_Next];
            m_Next = (m_Next + 1) % m_Sources.Count;
            return next;
        }

        private void OnDestroy()
        {
            if (s_Instance == this)
            {
                s_Instance = null;
            }
        }
    }
}
