using FPS.Core;
using FPS.Data;
using UnityEngine;

namespace FPS.Weapons
{
    /// <summary>World-space weapon model seen by other players (and casting the local player's shadow).</summary>
    public class ThirdPersonWeapon : MonoBehaviour
    {
        [SerializeField] private float m_ModelScale = 0.9f;

        private WeaponModelParts m_Parts;
        private float m_FlashEndTime;
        private bool m_ShadowsOnly;

        public Vector3 MuzzlePosition => m_Parts.Muzzle != null ? m_Parts.Muzzle.position : transform.position + transform.forward * 0.5f;

        public void Show(WeaponData data)
        {
            if (m_Parts.Root != null)
            {
                Destroy(m_Parts.Root);
            }

            if (data == null || !WeaponEffects.IsSupported)
            {
                m_Parts = default;
                return;
            }

            m_Parts = ProceduralWeaponModel.Build(data, transform, GameLayers.ViewModel, true, m_ModelScale);
            ApplyShadowMode();
        }

        /// <summary>For the local player: keep the third person gun as a shadow caster only.</summary>
        public void SetShadowsOnly(bool shadowsOnly)
        {
            m_ShadowsOnly = shadowsOnly;
            ApplyShadowMode();
        }

        private void ApplyShadowMode()
        {
            if (m_Parts.Root == null)
            {
                return;
            }

            foreach (Renderer renderer in m_Parts.Root.GetComponentsInChildren<Renderer>(true))
            {
                if (renderer == m_Parts.MuzzleFlash)
                {
                    continue;
                }

                renderer.shadowCastingMode = m_ShadowsOnly ? UnityEngine.Rendering.ShadowCastingMode.ShadowsOnly : UnityEngine.Rendering.ShadowCastingMode.On;
            }
        }

        public void SetAimPitch(float pitchDegrees)
        {
            transform.localRotation = Quaternion.Euler(-pitchDegrees, 0f, 0f);
        }

        public void PlayMuzzleFlash()
        {
            if (m_ShadowsOnly)
            {
                return;
            }

            m_FlashEndTime = Time.time + 0.05f;
            if (m_Parts.MuzzleFlash != null)
            {
                m_Parts.MuzzleFlash.enabled = true;
            }

            if (m_Parts.MuzzleLight != null)
            {
                m_Parts.MuzzleLight.enabled = true;
                m_Parts.MuzzleLight.intensity = 2f;
            }
        }

        private void LateUpdate()
        {
            if (m_Parts.Root != null && Time.time >= m_FlashEndTime)
            {
                if (m_Parts.MuzzleFlash != null) m_Parts.MuzzleFlash.enabled = false;
                if (m_Parts.MuzzleLight != null) m_Parts.MuzzleLight.enabled = false;
            }
        }
    }
}
