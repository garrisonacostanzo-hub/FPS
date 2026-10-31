using UnityEngine;

namespace FPS.Core
{
    /// <summary>
    /// Central definition of the physics layers used by the project.
    /// The editor builder (FPS > Build Everything) writes these names into ProjectSettings/TagManager.asset
    /// at exactly these indices, so runtime code can rely on the constant indices even before the names exist.
    /// </summary>
    public static class GameLayers
    {
        public const int Default = 0;
        public const int IgnoreRaycast = 2;
        public const int Environment = 8;
        public const int Combatant = 9;
        public const int Hitbox = 10;
        public const int Props = 11;
        public const int Trigger = 12;
        public const int ViewModel = 13;

        public static readonly string[] LayerNames =
        {
            null, null, null, null, null, null, null, null,
            "Environment", "Combatant", "Hitbox", "Props", "Trigger", "ViewModel"
        };

        /// <summary>Everything a bullet can hit (hitboxes instead of the movement capsule).</summary>
        public static int ShootableMask => (1 << Default) | (1 << Environment) | (1 << Hitbox) | (1 << Props);

        /// <summary>Everything that blocks line of sight for AI perception and cover evaluation.</summary>
        public static int VisionBlockMask => (1 << Default) | (1 << Environment) | (1 << Props);

        /// <summary>Static world geometry used for ground checks, cover generation and spawn validation.</summary>
        public static int WorldMask => (1 << Default) | (1 << Environment) | (1 << Props);

        /// <summary>Character movement capsules (players and bots).</summary>
        public static int CombatantMask => 1 << Combatant;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void ConfigurePhysicsMatrix()
        {
            // Hitboxes and view models never take part in physical collisions; they are only ray/overlap targets.
            for (int layer = 0; layer < 32; layer++)
            {
                Physics.IgnoreLayerCollision(Hitbox, layer, true);
                Physics.IgnoreLayerCollision(ViewModel, layer, true);
            }

            // Triggers only need to detect combatants.
            for (int layer = 0; layer < 32; layer++)
            {
                if (layer != Combatant)
                {
                    Physics.IgnoreLayerCollision(Trigger, layer, true);
                }
            }
        }

        public static void SetLayerRecursively(GameObject root, int layer)
        {
            if (root == null)
            {
                return;
            }

            root.layer = layer;
            foreach (Transform child in root.transform)
            {
                SetLayerRecursively(child.gameObject, layer);
            }
        }
    }
}
