#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 uResolution;
uniform vec2 uMutter;
uniform vec2 uKind;
uniform float uRadius;
uniform float uIntensity;

varying vec2 vTexCoord;

void main() {
    vec2 pixel = vTexCoord * uResolution;

    float d1 = distance(pixel, uMutter);
    float d2 = distance(pixel, uKind);

    float r = uRadius;

    float field1 = (r * r) / max(d1 * d1, 1.0);
    float field2 = (r * r) / max(d2 * d2, 1.0);

    float field = field1 + field2;

    float core = smoothstep(1.0, 1.25, field);
    float glow = smoothstep(0.15, 1.0, field) * 0.45;

    float alpha = (core * 0.85 + glow) * uIntensity;

    if (alpha <= 0.001) {
        discard;
    }

    vec3 edgeColor = vec3(1.0, 0.25, 0.7);
    vec3 coreColor = vec3(1.0, 0.82, 0.95);

    vec3 color = mix(edgeColor, coreColor, core);

    gl_FragColor = vec4(color, alpha);
}