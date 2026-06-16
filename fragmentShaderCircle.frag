precision highp float;

uniform int objects;

uniform float xs[objects];
uniform float ys[objects];
uniform float rs[objects];

varying highp vec2 vPos;

// called once per pixel (equivalent to the body of your for loops over x and y)
void main() {
    float sum = 0.;

    // calculate the sum value for the current pixel (vPos.x, vPos.y)
    for (int i = 0; i < objects; i++) {
        float dx = xs[i] - vPos.x;
        float dy = ys[i] - vPos.y;
        float d = length(vec2(dx, dy));
        sum += rs[i] / d;
    }

    // Set the pixel color based on the sum of distances to the balls
    if (sum > 4.) {
        gl_FragColor = vec4(vec3(0.95,0.3,0.), 1.);
    } else {
        gl_FragColor = vec4(vec3(0.25,0.,0.25), 1.);
    }
}