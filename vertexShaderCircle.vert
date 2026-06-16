attribute vec3 aPosition;

// Uniforms allow you to pass information from JavaScript to your shader
uniform float width;
uniform float height;

// Varying values pass data from the vertex shader to the fragment shader
// their values will be smoothly interpolated from one vertex to the next
varying highp vec2 vPos;

void main() {
    // convert position attribute into screen position (-1, -1) to (1, 1)
    gl_Position = vec4(aPosition, 1.0);
    // convert position in screen space to position in pixel space
    vPos = vec2(
            (gl_Position.x + 1.) / 2. * width,
            (gl_Position.y + 1.) / 2. * height);
}