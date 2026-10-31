using System.Collections.Generic;
using UnityEngine;

namespace FPS.EditorTools
{
    /// <summary>Procedural meshes used by the prototype kit (noise-displaced icosphere rocks with real LOD reduction).</summary>
    public static class MeshGenerator
    {
        public static Mesh CreateRock(int subdivisions, int seed)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            CreateIcosahedron(vertices, triangles);
            var cache = new Dictionary<long, int>();
            for (int s = 0; s < subdivisions; s++)
            {
                var next = new List<int>(triangles.Count * 4);
                cache.Clear();
                for (int i = 0; i < triangles.Count; i += 3)
                {
                    int a = triangles[i];
                    int b = triangles[i + 1];
                    int c = triangles[i + 2];
                    int ab = Midpoint(a, b, vertices, cache);
                    int bc = Midpoint(b, c, vertices, cache);
                    int ca = Midpoint(c, a, vertices, cache);
                    next.AddRange(new[] { a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca });
                }

                triangles = next;
            }

            // Deterministic displacement (same seed for every LOD so silhouettes match).
            for (int i = 0; i < vertices.Count; i++)
            {
                Vector3 v = vertices[i].normalized;
                float noise = Mathf.PerlinNoise(v.x * 1.7f + seed * 0.01f, v.z * 1.7f + v.y) * 0.45f
                              + Mathf.PerlinNoise(v.y * 3.1f + seed * 0.02f, v.x * 3.1f) * 0.2f;
                float flatten = v.y < -0.2f ? 0.75f : 1f;
                vertices[i] = new Vector3(v.x, v.y * 0.75f * flatten, v.z) * (0.75f + noise);
            }

            // Flat shading: unique vertices per triangle.
            var flatVertices = new Vector3[triangles.Count];
            var flatTriangles = new int[triangles.Count];
            var uvs = new Vector2[triangles.Count];
            for (int i = 0; i < triangles.Count; i++)
            {
                flatVertices[i] = vertices[triangles[i]];
                flatTriangles[i] = i;
                uvs[i] = new Vector2(flatVertices[i].x + flatVertices[i].y, flatVertices[i].z + flatVertices[i].y);
            }

            var mesh = new Mesh { vertices = flatVertices, triangles = flatTriangles, uv = uvs };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            return mesh;
        }

        private static void CreateIcosahedron(List<Vector3> vertices, List<int> triangles)
        {
            float t = (1f + Mathf.Sqrt(5f)) / 2f;
            vertices.AddRange(new[]
            {
                new Vector3(-1, t, 0), new Vector3(1, t, 0), new Vector3(-1, -t, 0), new Vector3(1, -t, 0),
                new Vector3(0, -1, t), new Vector3(0, 1, t), new Vector3(0, -1, -t), new Vector3(0, 1, -t),
                new Vector3(t, 0, -1), new Vector3(t, 0, 1), new Vector3(-t, 0, -1), new Vector3(-t, 0, 1)
            });
            for (int i = 0; i < vertices.Count; i++)
            {
                vertices[i] = vertices[i].normalized;
            }

            triangles.AddRange(new[]
            {
                0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
                1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
                3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
                4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
            });
        }

        private static int Midpoint(int a, int b, List<Vector3> vertices, Dictionary<long, int> cache)
        {
            long key = a < b ? ((long)a << 32) + b : ((long)b << 32) + a;
            if (cache.TryGetValue(key, out int index))
            {
                return index;
            }

            vertices.Add(((vertices[a] + vertices[b]) * 0.5f).normalized);
            index = vertices.Count - 1;
            cache[key] = index;
            return index;
        }
    }
}
