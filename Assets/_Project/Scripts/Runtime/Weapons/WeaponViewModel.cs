using FPS.Core;
using FPS.Data;
using UnityEngine;

namespace FPS.Weapons
{
    /// <summary>
    /// First person weapon presentation for the local player: hip/ADS blend, sway, bob, procedural recoil
    /// kick, reload/equip animation, sprint pose, wall retraction and muzzle flash.
    /// Purely cosmetic - all gameplay lives in <see cref="WeaponSystem"/>.
    /// </summary>
    public class WeaponViewModel : MonoBehaviour
    {
        [SerializeField] private float m_SwayAmount = 0.02f;
        [SerializeField] private float m_SwaySmoothing = 10f;
        [SerializeField] private float m_BobAmount = 0.012f;
        [SerializeField] private float m_KickBack = 0.045f;
        [SerializeField] private float m_KickPitch = 4.5f;
        [SerializeField] private float m_WallCheckDistance = 0.75f;

        private WeaponModelParts m_Parts;
        private WeaponData m_Data;
        private Quaternion m_LastParentRotation;
        private Vector3 m_SwayPosition;
        private Quaternion m_SwayRotation = Quaternion.identity;
        private float m_Kick;
        private float m_KickVelocity;
        private float m_BobPhase;
        private float m_AimFraction;
        private float m_Sprint;
        private float m_MoveSpeed01;
        private float m_ReloadStart;
        private float m_ReloadDuration;
        private float m_EquipStart;
        private float m_EquipDuration;
        private float m_FlashEndTime;
        private float m_Retract;
        private Vector3 m_MagazineRest;

        public Vector3 MuzzlePosition => m_Parts.Muzzle != null ? m_Parts.Muzzle.position : transform.position + transform.forward * 0.6f;
        public bool HasModel => m_Parts.Root != null;

        private void Awake()
        {
            m_LastParentRotation = transform.parent != null ? transform.parent.rotation : Quaternion.identity;
        }

        public void Equip(WeaponData data, float equipDuration)
        {
            if (m_Parts.Root != null)
            {
                Destroy(m_Parts.Root);
            }

            m_Data = data;
            m_Parts = ProceduralWeaponModel.Build(data, transform, GameLayers.ViewModel, false);
            m_MagazineRest = m_Parts.Magazine != null ? m_Parts.Magazine.localPosition : Vector3.zero;
            m_EquipStart = Time.time;
            m_EquipDuration = Mathf.Max(0.01f, equipDuration);
            m_ReloadDuration = 0f;
            m_Kick = 0f;
            m_KickVelocity = 0f;
        }

        public void Clear()
        {
            if (m_Parts.Root != null)
            {
                Destroy(m_Parts.Root);
            }

            m_Parts = default;
            m_Data = null;
        }

        public void SetVisible(bool visible)
        {
            if (m_Parts.Root != null)
            {
                m_Parts.Root.SetActive(visible);
            }
        }

        public void SetState(float aimFraction, bool sprinting, float moveSpeed01)
        {
            m_AimFraction = aimFraction;
            m_Sprint = Mathf.MoveTowards(m_Sprint, sprinting ? 1f : 0f, Time.deltaTime * 6f);
            m_MoveSpeed01 = moveSpeed01;
        }

        public void OnFire()
        {
            m_KickVelocity += 1f;
            m_FlashEndTime = Time.time + 0.045f;
            if (m_Parts.MuzzleFlash != null)
            {
                m_Parts.MuzzleFlash.enabled = true;
                m_Parts.MuzzleFlash.transform.localRotation = Quaternion.Euler(0f, 0f, Random.Range(0f, 360f));
            }

            if (m_Parts.MuzzleLight != null)
            {
                m_Parts.MuzzleLight.enabled = true;
                m_Parts.MuzzleLight.intensity = 2.5f;
            }
        }

        public void OnReloadStarted(float duration)
        {
            m_ReloadStart = Time.time;
            m_ReloadDuration = duration;
        }

        public void OnReloadCancelled()
        {
            m_ReloadDuration = 0f;
        }

        private void LateUpdate()
        {
            if (m_Parts.Root == null || m_Data == null)
            {
                return;
            }

            float deltaTime = Time.deltaTime;
            Transform root = m_Parts.Root.transform;

            // Sway from camera rotation delta.
            Quaternion parentRotation = transform.parent != null ? transform.parent.rotation : Quaternion.identity;
            Quaternion delta = Quaternion.Inverse(m_LastParentRotation) * parentRotation;
            m_LastParentRotation = parentRotation;
            Vector3 euler = delta.eulerAngles;
            float yawDelta = Mathf.DeltaAngle(0f, euler.y);
            float pitchDelta = Mathf.DeltaAngle(0f, euler.x);
            float swayScale = Mathf.Lerp(1f, 0.25f, m_AimFraction);
            Vector3 targetSwayPosition = new Vector3(-yawDelta, pitchDelta, 0f) * (m_SwayAmount * 0.1f * swayScale);
            targetSwayPosition = Vector3.ClampMagnitude(targetSwayPosition, 0.06f);
            Quaternion targetSwayRotation = Quaternion.Euler(pitchDelta * 0.8f * swayScale, yawDelta * 0.8f * swayScale, -yawDelta * 1.2f * swayScale);
            float swayT = 1f - Mathf.Exp(-m_SwaySmoothing * deltaTime);
            m_SwayPosition = Vector3.Lerp(m_SwayPosition, targetSwayPosition, swayT);
            m_SwayRotation = Quaternion.Slerp(m_SwayRotation, targetSwayRotation, swayT);

            // Bob.
            m_BobPhase += deltaTime * Mathf.Lerp(4f, 11f, m_MoveSpeed01);
            float bobScale = m_BobAmount * m_MoveSpeed01 * Mathf.Lerp(1f, 0.2f, m_AimFraction) * (1f + m_Sprint);
            Vector3 bob = new Vector3(Mathf.Sin(m_BobPhase) * bobScale, Mathf.Abs(Mathf.Cos(m_BobPhase)) * bobScale, 0f);

            // Recoil spring.
            const float stiffness = 180f;
            const float damping = 18f;
            m_KickVelocity += (-m_Kick * stiffness - m_KickVelocity * damping) * deltaTime;
            m_Kick += m_KickVelocity * deltaTime * 10f;
            float kick = Mathf.Max(0f, m_Kick);
            float aimKickScale = Mathf.Lerp(1f, 0.45f, m_AimFraction);

            // Reload: dip and tilt, magazine drops out and back in.
            float reloadWeight = 0f;
            if (m_ReloadDuration > 0f)
            {
                float t = (Time.time - m_ReloadStart) / m_ReloadDuration;
                if (t >= 1f)
                {
                    m_ReloadDuration = 0f;
                }
                else
                {
                    reloadWeight = Mathf.Sin(Mathf.Clamp01(t) * Mathf.PI);
                    if (m_Parts.Magazine != null)
                    {
                        float magDrop = t < 0.5f ? Mathf.SmoothStep(0f, 1f, t * 2f) : Mathf.SmoothStep(1f, 0f, (t - 0.5f) * 2f);
                        m_Parts.Magazine.localPosition = m_MagazineRest + Vector3.down * (magDrop * 0.25f);
                    }
                }
            }
            else if (m_Parts.Magazine != null)
            {
                m_Parts.Magazine.localPosition = m_MagazineRest;
            }

            // Equip raise.
            float equip = 1f - Mathf.Clamp01((Time.time - m_EquipStart) / m_EquipDuration);
            equip = equip * equip;

            // Wall retraction.
            float retractTarget = 0f;
            if (transform.parent != null && Physics.Raycast(transform.parent.position, transform.parent.forward, out RaycastHit hit, m_WallCheckDistance, GameLayers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                retractTarget = 1f - hit.distance / m_WallCheckDistance;
            }

            m_Retract = Mathf.Lerp(m_Retract, retractTarget, 1f - Mathf.Exp(-12f * deltaTime));

            Vector3 basePosition = Vector3.Lerp(m_Data.hipOffset, m_Data.aimOffset, m_AimFraction);
            Vector3 sprintOffset = new Vector3(-0.06f, -0.05f, -0.04f) * m_Sprint;
            Vector3 position = basePosition + m_SwayPosition + bob + sprintOffset
                               + new Vector3(0f, 0f, -kick * m_KickBack * aimKickScale)
                               + new Vector3(0f, -0.12f, -0.05f) * reloadWeight
                               + new Vector3(0f, -0.3f, 0f) * equip
                               + new Vector3(0f, -0.04f, -0.18f) * m_Retract;

            Quaternion rotation = m_SwayRotation
                                  * Quaternion.Euler(-kick * m_KickPitch * aimKickScale, 0f, 0f)
                                  * Quaternion.Euler(18f * reloadWeight, -8f * reloadWeight, 25f * reloadWeight)
                                  * Quaternion.Euler(25f * m_Sprint, -30f * m_Sprint, 12f * m_Sprint)
                                  * Quaternion.Euler(40f * equip, 0f, 0f)
                                  * Quaternion.Euler(-20f * m_Retract, 0f, 0f);

            root.localPosition = position;
            root.localRotation = rotation;

            if (Time.time >= m_FlashEndTime)
            {
                if (m_Parts.MuzzleFlash != null) m_Parts.MuzzleFlash.enabled = false;
                if (m_Parts.MuzzleLight != null) m_Parts.MuzzleLight.enabled = false;
            }
        }
    }
}
