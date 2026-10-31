using System.Collections.Generic;
using UnityEngine;

namespace FPS.Core
{
    public enum ProceduralSound
    {
        RifleShot,
        PistolShot,
        ShotgunShot,
        SniperShot,
        SmgShot,
        Footstep,
        DryFire,
        ReloadStart,
        ReloadEnd,
        Hitmarker,
        Killmarker,
        Hurt,
        CaptureTick
    }

    /// <summary>
    /// Synthesises placeholder sound effects at runtime so the prototype is fully audible without imported assets.
    /// Every clip is generated once and cached. Replace with authored clips through <see cref="Data.WeaponData"/>.
    /// </summary>
    public static class ProceduralAudio
    {
        private const int k_SampleRate = 44100;
        private static readonly Dictionary<ProceduralSound, AudioClip> s_Cache = new Dictionary<ProceduralSound, AudioClip>();

        public static AudioClip Get(ProceduralSound sound)
        {
            if (s_Cache.TryGetValue(sound, out AudioClip clip) && clip != null)
            {
                return clip;
            }

            clip = Generate(sound);
            s_Cache[sound] = clip;
            return clip;
        }

        private static AudioClip Generate(ProceduralSound sound)
        {
            switch (sound)
            {
                case ProceduralSound.RifleShot: return Gunshot("RifleShot", 0.32f, 0.55f, 180f, 11);
                case ProceduralSound.PistolShot: return Gunshot("PistolShot", 0.22f, 0.45f, 260f, 23);
                case ProceduralSound.ShotgunShot: return Gunshot("ShotgunShot", 0.55f, 0.75f, 90f, 37);
                case ProceduralSound.SniperShot: return Gunshot("SniperShot", 0.8f, 0.85f, 70f, 41);
                case ProceduralSound.SmgShot: return Gunshot("SmgShot", 0.18f, 0.4f, 320f, 53);
                case ProceduralSound.Footstep: return Thump("Footstep", 0.09f, 95f, 0.35f, 61);
                case ProceduralSound.DryFire: return Click("DryFire", 0.04f, 2400f, 0.35f);
                case ProceduralSound.ReloadStart: return Click("ReloadStart", 0.08f, 900f, 0.5f);
                case ProceduralSound.ReloadEnd: return Click("ReloadEnd", 0.1f, 1400f, 0.6f);
                case ProceduralSound.Hitmarker: return Tone("Hitmarker", 0.05f, 1900f, 0.35f);
                case ProceduralSound.Killmarker: return Tone("Killmarker", 0.14f, 1250f, 0.45f);
                case ProceduralSound.Hurt: return Thump("Hurt", 0.18f, 140f, 0.5f, 71);
                case ProceduralSound.CaptureTick: return Tone("CaptureTick", 0.06f, 880f, 0.25f);
                default: return Tone("Blip", 0.05f, 1000f, 0.3f);
            }
        }

        private static AudioClip Gunshot(string name, float duration, float volume, float bodyFrequency, int seed)
        {
            int samples = Mathf.CeilToInt(duration * k_SampleRate);
            var data = new float[samples];
            var random = new System.Random(seed);
            float lowPass = 0f;
            for (int i = 0; i < samples; i++)
            {
                float t = i / (float)k_SampleRate;
                float envelope = Mathf.Exp(-t * (12f / duration));
                float crack = (float)(random.NextDouble() * 2.0 - 1.0);
                lowPass = Mathf.Lerp(lowPass, crack, 0.35f);
                float body = Mathf.Sin(2f * Mathf.PI * bodyFrequency * t * (1f - t * 0.8f)) * Mathf.Exp(-t * 18f);
                data[i] = Mathf.Clamp((lowPass * 0.75f + body * 0.6f) * envelope * volume, -1f, 1f);
            }

            return CreateClip(name, data);
        }

        private static AudioClip Thump(string name, float duration, float frequency, float volume, int seed)
        {
            int samples = Mathf.CeilToInt(duration * k_SampleRate);
            var data = new float[samples];
            var random = new System.Random(seed);
            for (int i = 0; i < samples; i++)
            {
                float t = i / (float)k_SampleRate;
                float envelope = Mathf.Exp(-t * (9f / duration));
                float noise = (float)(random.NextDouble() * 2.0 - 1.0) * 0.25f;
                data[i] = (Mathf.Sin(2f * Mathf.PI * frequency * t) + noise) * envelope * volume;
            }

            return CreateClip(name, data);
        }

        private static AudioClip Click(string name, float duration, float frequency, float volume)
        {
            int samples = Mathf.CeilToInt(duration * k_SampleRate);
            var data = new float[samples];
            for (int i = 0; i < samples; i++)
            {
                float t = i / (float)k_SampleRate;
                float envelope = Mathf.Exp(-t * (14f / duration));
                float square = Mathf.Sign(Mathf.Sin(2f * Mathf.PI * frequency * t));
                data[i] = square * envelope * volume * 0.5f;
            }

            return CreateClip(name, data);
        }

        private static AudioClip Tone(string name, float duration, float frequency, float volume)
        {
            int samples = Mathf.CeilToInt(duration * k_SampleRate);
            var data = new float[samples];
            for (int i = 0; i < samples; i++)
            {
                float t = i / (float)k_SampleRate;
                float attack = Mathf.Clamp01(t / 0.004f);
                float envelope = attack * Mathf.Exp(-t * (6f / duration));
                data[i] = Mathf.Sin(2f * Mathf.PI * frequency * t) * envelope * volume;
            }

            return CreateClip(name, data);
        }

        private static AudioClip CreateClip(string name, float[] data)
        {
            AudioClip clip = AudioClip.Create("Procedural_" + name, data.Length, 1, k_SampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }
    }
}
