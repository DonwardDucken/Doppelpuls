const sketch = (p) => {
    // ============================================================
    // CONFIG — all tunable constants in one place
    // ============================================================
    const CONFIG = {
        background: [10, 2, 18],
        trailAlpha: 0.22,
        margin: 34,
        inputThreshold: 0.03,
        serialTimeout: 1200,
        emitters: {
            mutter: {
                color: [195, 22, 58],
                glowColor: "rgba(195, 22, 58, 0.4)",
                accelKeyboard: 1,
                accelSerial: 2,
                drag: 0.85,
                maxSpeed: 6,
                bpm: 90,
                vibration: 8,
                ringBaseSize: 35,
                ringDecay: 0.012,
                ringGrowth: 0.6,
                ringLineWidth: 1.0,
                ringIntervalBase: 460*1.25,
                ringIntervalGain: 260,
                ringIntervalMin: 120,
                coreRadius: 9,
                corePulseFreq: 0.004,
                coreShadow: 22,
            },
            kind: {
                color: [200, 160, 255],
                glowColor: "rgba(220, 180, 255, 0.4)",
                accelKeyboard: 3,
                accelSerial: 4,
                drag: 0.925,
                maxSpeed: 7,
                bpm: 140,
                vibration: 5,
                ringBaseSize: 14,
                ringDecay: 0.028,
                ringGrowth: 0.9,
                ringLineWidth: 0.5,
                ringIntervalBase: 130*1.25,
                ringIntervalGain: 55,
                ringIntervalMin: 55,
                coreRadius: 6,
                corePulseFreq: 0.008,
                coreShadow: 16,
            },
        },
        fusion: {
            proximityDistance: 95,
            progressGain: 0.035,
            progressDecay: 0.04,
            holdDuration: 4000,
            returnDuration: 1500,
            bellInterval: 1600,
            sphereColor: [255, 182, 193],
            sphereMaxRadius: 60,
            spherePulseFreq: 0.01,
            spherePulseAmp: 0.06,
            fusionTargetRadius: 40,
            FUSION_TRIGGER_DIST: 60,
        },
        ambient: {
            ringInterval: 2500,
            soundInterval: 3000,
        },
    };

    const FusionState = Object.freeze({
        FREE: "free",
        FUSING: "fusing",
        RETURNING: "returning",
    });

    // ============================================================
    // STATE
    // ============================================================
    let particles = [];
    let ambientRings = [];
    let posMutter, posKind, velMutter, velKind;
    let startMutter, startKind, fusionMeetPoint;
    let isPaused = false;

    let fusionState = FusionState.FREE;
    let fusionProgress = 0;
    let fusionHoldStartTime = 0;
    let returnStartTime = 0;
    let currentScore = 0;
    let scoreMutter = 0;
    let scoreKind = 0;
    const SCORE_MAX = 5;
    let fusionTarget = null;

    let lastBeatMutter = 0;
    let lastBeatKind = 0;
    let lastRingMutter = 0;
    let lastRingKind = 0;
    let lastAmbientTime = 0;
    let lastAmbientSoundTime = 0;
    let lastFusionBellTime = 0;

    let scoreFont;
    let layer; //für den Frambuffer
    //let fusionShader; //für die Shader



    // Per-frame movement activity, read by the delayed audio echo callbacks
    const motion = { mutterActive: false, kindActive: false };

    // ============================================================
    // DOM REFS
    // ============================================================
    const vibElement = document.getElementById("vibration");
    const pauseIndicator = document.getElementById("pause-indicator");
    const connectButton = document.getElementById("connect-button");
    const calibrateButton = document.getElementById("calibrate-button");
    const serialStatus = document.getElementById("serial-status");
    const serialValues = document.getElementById("serial-values");
    const scoreValueElement = document.getElementById("score-value");
    const scoreMutterEl = document.getElementById("score-mutter");
    const scoreKindEl   = document.getElementById("score-kind");

    // ============================================================
    // SERIAL (Web Serial API — two Arduino joysticks)
    // ============================================================
    let port, reader;
    let serialBuffer = "";
    let isSerialOpen = false;
    let lastSerialAt = 0;
    let autoCenterSamples = 0;
    const autoCenterTarget = 8;

    const joystick = {
        one: { rawX: 512, rawY: 512, centerX: 512, centerY: 512, x: 0, y: 0 },
        two: { rawX: 512, rawY: 512, centerX: 512, centerY: 512, x: 0, y: 0 },
    };

    function normalizeAxis(value, center) {
        const deadzone = 90;
        const delta = value - center;
        const magnitude = Math.abs(delta);
        if (magnitude < deadzone) return 0;
        const range = delta > 0 ? 1023 - center : center;
        const normalized = (magnitude - deadzone) / Math.max(1, range - deadzone);
        return Math.sign(delta) * Math.min(1, normalized);
    }

    function refreshJoystick(joy) {
        joy.x = normalizeAxis(joy.rawX, joy.centerX);
        joy.y = normalizeAxis(joy.rawY, joy.centerY);
    }

    function calibrateJoysticks() {
        joystick.one.centerX = joystick.one.rawX;
        joystick.one.centerY = joystick.one.rawY;
        joystick.two.centerX = joystick.two.rawX;
        joystick.two.centerY = joystick.two.rawY;
        autoCenterSamples = autoCenterTarget;
        refreshJoystick(joystick.one);
        refreshJoystick(joystick.two);
        serialStatus.textContent = isSerialOpen ? "Nullpunkt gesetzt" : "Nullpunkt lokal";
    }

    async function connectSerial() {
        if (!("serial" in navigator)) return;
        try {
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: 9600 });
            isSerialOpen = true;
            autoCenterSamples = 0;
            connectButton.disabled = true;
            connectButton.textContent = "Verbunden";
            serialStatus.textContent = "Warte auf Daten";
            readSerial();
        } catch (error) {
            serialStatus.textContent = "Nicht verbunden";
            console.error(error);
        }
    }

    async function readSerial() {
        const decoder = new TextDecoder();
        try {
            reader = port.readable.getReader();
            while (isSerialOpen) {
                const { value, done } = await reader.read();
                if (done) break;
                serialBuffer += decoder.decode(value, { stream: true });
                const lines = serialBuffer.split(/\r?\n/);
                serialBuffer = lines.pop();
                lines.forEach(parseSerialLine);
            }
        } catch (error) {
            console.error(error);
            serialStatus.textContent = "Verbindung verloren";
        } finally {
            if (reader) reader.releaseLock();
        }
    }

    function parseSerialLine(line) {
        const values = {};
        for (const match of line.matchAll(/JOY\s*([12])\s*([XY]):\s*(\d+)/gi)) {
            values[`joy${match[1]}${match[2].toUpperCase()}`] = Number(match[3]);
        }
        for (const match of line.matchAll(/A([0-3]):\s*(\d+)/gi)) {
            const value = Number(match[2]);
            if (match[1] === "0") values.joy1X = value;
            if (match[1] === "1") values.joy1Y = value;
            if (match[1] === "2") values.joy2X = value;
            if (match[1] === "3") values.joy2Y = value;
        }
        if (
            values.joy1X === undefined ||
            values.joy1Y === undefined ||
            values.joy2X === undefined ||
            values.joy2Y === undefined
        ) {
            return;
        }

        joystick.one.rawX = values.joy1X;
        joystick.one.rawY = values.joy1Y;
        joystick.two.rawX = values.joy2X;
        joystick.two.rawY = values.joy2Y;

        if (autoCenterSamples < autoCenterTarget) {
            const weight = autoCenterSamples;
            joystick.one.centerX = (joystick.one.centerX * weight + joystick.one.rawX) / (weight + 1);
            joystick.one.centerY = (joystick.one.centerY * weight + joystick.one.rawY) / (weight + 1);
            joystick.two.centerX = (joystick.two.centerX * weight + joystick.two.rawX) / (weight + 1);
            joystick.two.centerY = (joystick.two.centerY * weight + joystick.two.rawY) / (weight + 1);
            autoCenterSamples += 1;
        }

        refreshJoystick(joystick.one);
        refreshJoystick(joystick.two);
        lastSerialAt = p.millis();
        serialStatus.textContent = autoCenterSamples < autoCenterTarget ? "Kalibriere" : "Daten aktiv";
        serialValues.textContent = `J1 ${joystick.one.rawX}/${joystick.one.rawY} J2 ${joystick.two.rawX}/${joystick.two.rawY}`;
    }

    window.addEventListener("beforeunload", async () => {
        isSerialOpen = false;
        if (reader) {
            try {
                await reader.cancel();
            } catch (error) {
                console.error(error);
            }
        }
        if (port) {
            try {
                await port.close();
            } catch (error) {
                console.error(error);
            }
        }
    });

    // ============================================================
    // AUDIO — Tone.js synths (kept on Tone.js so the page runs from
    // a plain file:// double-click; p5.sound needs an http origin).
    // ============================================================
    const audio = (() => {
        let motherSynth, childSynth, ambientSynth, fusionSynth;
        let started = false;
        const ambientTones = ["C4", "E4", "G4", "A4"];
        const fusionChord = ["C4", "E4", "G4", "C5", "E5"];

        function init() {
            motherSynth = new Tone.Synth({
                oscillator: { type: "sine" },
                envelope: { attack: 0.04, decay: 0.22, sustain: 0.0, release: 0.3 },
            }).toDestination();

            childSynth = new Tone.Synth({
                oscillator: { type: "sine" },
                envelope: { attack: 0.01, decay: 0.12, sustain: 0.0, release: 0.15 },
            }).toDestination();

            ambientSynth = new Tone.Synth({
                oscillator: { type: "sine" },
                envelope: { attack: 1.5, decay: 1.5, sustain: 0.4, release: 2.0 },
            }).toDestination();

            fusionSynth = new Tone.PolySynth(Tone.Synth, {
                oscillator: { type: "sine" },
                envelope: { attack: 0.1, decay: 1.2, sustain: 0.1, release: 1.2 },
            }).toDestination();
            fusionSynth.volume.value = -14;

            started = true;
        }

        return {
            // Must be called from a user gesture to unlock the AudioContext
            start() {
                if (started) return;
                Tone.start().then(init);
            },
            motherBeat(velocity = 1.0) {
                if (started) motherSynth.triggerAttackRelease("C3", "12n", undefined, velocity);
            },
            childBeat(velocity = 1.0) {
                if (started) childSynth.triggerAttackRelease("C4", "16n", undefined, velocity);
            },
            ambientSwell() {
                if (!started) return;
                const note = ambientTones[Math.floor(Math.random() * ambientTones.length)];
                ambientSynth.triggerAttackRelease(note, "2n");
            },
            fusionBell() {
                if (!started) return;
                fusionSynth.triggerAttackRelease(fusionChord, "1.8s");
            },
        };
    })();

    // ============================================================
    // INPUT — one unified vector per player, keyboard OR joystick
    // WASD key codes: A=65, D=68, W=87, S=83
    // ============================================================
    function getInputVector(playerKey, serialActive) {
        if (serialActive) {
            return playerKey === "mutter" ? joystick.one : joystick.two;
        }
        if (playerKey === "mutter") {
            return {
                x: (p.keyIsDown(p.RIGHT_ARROW) ? 1 : 0) - (p.keyIsDown(p.LEFT_ARROW) ? 1 : 0),
                y: (p.keyIsDown(p.DOWN_ARROW) ? 1 : 0) - (p.keyIsDown(p.UP_ARROW) ? 1 : 0),
            };
        }
        return {
            x: (p.keyIsDown(68) ? 1 : 0) - (p.keyIsDown(65) ? 1 : 0),
            y: (p.keyIsDown(83) ? 1 : 0) - (p.keyIsDown(87) ? 1 : 0),
        };
    }

    // ============================================================
    // PHYSICS — vector-based acceleration with drag and speed cap
    // ============================================================
    function moveEmitter(pos, vel, input, accel, drag, maxSpeed) {
        vel.x += input.x * accel;
        vel.y += input.y * accel;
        vel.mult(drag);
        vel.limit(maxSpeed);
        pos.add(vel);
        pos.x = p.constrain(pos.x,-p.width/2 + CONFIG.margin,p.width/2 - CONFIG.margin); //für webgl angepasst
        pos.y = p.constrain( pos.y,  -p.height/2 + CONFIG.margin, p.height/2 - CONFIG.margin); //für webgl angepasst
    }

    // ============================================================
    // ENTITIES
    // ============================================================
    class AmbientRing {
        constructor() {
            this.x = 0;
            this.y = -p.height * 0.05;
            this.radius = 20;
            this.maxRadius = Math.max(p.width, p.height) * 0.4;
            this.life = 1.0;
            this.speed = 2.5;
        }
        update() {
            this.radius += this.speed;
            this.life = Math.pow(1.0 - this.radius / this.maxRadius, 2);
        }
        draw() {
            if (this.life <= 0) return;
            p.noFill();
            p.stroke(255, 255, 255, this.life * 0.5);
            p.strokeWeight(1);
            drawSmoothCircle(this.x, this.y, this.radius * 2);
        }
    }

    class RingParticle {
        constructor(x, y, type, currentFusion) {
            const cfg = CONFIG.emitters[type];
            this.x = x;
            this.y = y;
            this.size = cfg.ringBaseSize;
            this.life = 1.0;
            this.decay = cfg.ringDecay;
            this.growth = cfg.ringGrowth;
            this.color = cfg.color;
            this.glowColor = cfg.glowColor;
            this.lineWidth = cfg.ringLineWidth;
            this.vx = (p.random() - 0.5) * 0.2;
            this.vy = (p.random() - 0.5) * 0.2;
            this.fusionDim = 1 - currentFusion * 0.7;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.life -= this.decay;
            this.size += this.growth;
        }
        draw() {
            const ctx = p.drawingContext;
            for(let i=3;i>0;i--){
                p.noFill();
                p.stroke(this.color[0],this.color[1],this.color[2],this.life * 0.08 * i);
                p.strokeWeight(this.lineWidth + i * 2);
                drawSmoothCircle(this.x,this.y,this.size * 2);
            }
            p.noFill();
            p.blendMode(p.ADD);
            p.stroke(this.color[0], this.color[1], this.color[2], this.life * 0.8 * this.fusionDim);
            p.strokeWeight(this.lineWidth);
            drawSmoothCircle(this.x, this.y, this.size * 2);
            // push()/pop() do NOT restore raw drawingContext shadow state — reset manually

        }
    }

    // ============================================================
    // RENDER HELPERS
    // ============================================================
    // p5's built-in circle()/ellipse() caps stroke detail at 50 vertices
    // in WEBGL mode (anything above that drops the stroke entirely).
    // For big, fast-growing rings that cap shows up as flat facets.
    // This draws our own polygon instead, with segment count scaled to
    // diameter, so large circles stay round at any size.
    function drawSmoothCircle(x, y, d) {
        const segments = p.constrain(Math.ceil(d * 0.35), 24, 160);
        p.beginShape();
        for (let i = 0; i <= segments; i++) {
            const a = (p.TWO_PI * i) / segments;
            p.vertex(x + (d / 2) * p.cos(a), y + (d / 2) * p.sin(a));
        }
        p.endShape(p.CLOSE);
    }

    function drawEmitterCore(pos, type, time) {
        const cfg = CONFIG.emitters[type];
        const radius = cfg.coreRadius + p.sin(time * cfg.corePulseFreq) * 2;
        drawGlowCircle(pos.x,pos.y,radius,cfg.color,6);
        p.blendMode(p.ADD);
    }

    function drawSphere(time, cx, cy, intensity) {
        const f = CONFIG.fusion;
        const pulse = 1 + p.sin(time * f.spherePulseFreq) * f.spherePulseAmp;
        const baseRadius = f.sphereMaxRadius * intensity;
        const ctx = p.drawingContext;
        //layer.begin();
        p.push();
        p.translate(cx, cy);
        //ctx.shadowBlur = 45 * intensity;
        //ctx.shadowColor = `rgba(${f.sphereColor.join(", ")}, 0.7)`;
        for(let i=4;i>0;i--){
            p.noFill();
            p.stroke(f.sphereColor[0],f.sphereColor[1],f.sphereColor[2],intensity * 0.08 * i);
            p.strokeWeight(4);
            drawSmoothCircle(0,0,(baseRadius * pulse + i * 6) * 2);
        }
        //p.noFill();
        //p.stroke(f.sphereColor[0], f.sphereColor[1], f.sphereColor[2], intensity * 0.9);
        //p.strokeWeight(3 * intensity);
        // p.circle(0, 0, baseRadius * pulse * 2); //ohne WEBGL
        //p.sphere(baseRadius*pulse);
        //p.blendMode(p.ADD);
        //ctx.shadowBlur = 0;
        p.pop();
        //layer.end();
    }

    function drawGlowCircle(x,y,r,col){
        p.noStroke();
        for(let i=5;i>0;i--){
            p.fill(col[0],col[1],col[2],0.04);
            drawSmoothCircle(x,y,r*2 + i*20);
        }
        p.fill(col[0],col[1],col[2],1);
        drawSmoothCircle(x,y,r*2);
    }
    // =============================================
    // FUSION TARGET (WEBGL VERSION)
    // =============================================
    function drawFusionTarget(time) {
        if (!fusionTarget) return;

        //layer.begin();
        p.push();

        // In WEBGL: sauber in Z-Ebene arbeiten
        p.translate(fusionTarget.x, fusionTarget.y);

        p.noFill();
        p.strokeWeight(2);

        // Pulsing radius
        const pulse = 1 + p.sin(time * 0.003) * 0.05;
        const r = CONFIG.fusion.fusionTargetRadius * pulse;

        // Nähe der Spieler bestimmt Glow
        const distM = p.dist(posMutter.x, posMutter.y, fusionTarget.x, fusionTarget.y);
        const distK = p.dist(posKind.x, posKind.y, fusionTarget.x, fusionTarget.y);
        const nearness = 1 - Math.min(1, (Math.min(distM, distK)) / 200);

        const alpha = 120 + nearness * 120;

        // Outer ring (single)
        p.noFill();
        p.stroke(255, 255, 255, alpha);
        p.strokeWeight(2);
        drawSmoothCircle(0, 0, r * 2);


        p.pop();
       // layer.end();
    }

    function triggerVibration(intensity) {
        if (isPaused) return;
        vibElement.style.boxShadow = `inset 0 0 0 ${intensity}px rgba(255, 255, 255, 0.07)`;
        setTimeout(() => {
            vibElement.style.boxShadow = "inset 0 0 0 0px rgba(255, 255, 255, 0)";
        }, 50);
    }

    // A heartbeat plus a softer echo if the emitter is still moving
    function playMotherHeartbeat() {
        audio.motherBeat(1.0);
        setTimeout(() => {
            if (!isPaused && motion.mutterActive && fusionState !== FusionState.FUSING) {
                audio.motherBeat(0.5);
            }
        }, 160);
    }

    function playChildHeartbeat() {
        audio.childBeat(1.0);
        setTimeout(() => {
            if (!isPaused && motion.kindActive && fusionState !== FusionState.FUSING) {
                audio.childBeat(0.5);
            }
        }, 110);
    }

    // ============================================================
    // SETUP STATE
    // ============================================================
    function initPositions() {
        startMutter = {x: -p.width * 0.3,y: p.height * 0.35}; //für webgl angepasst
        startKind = {x: p.width * 0.3,y: p.height * 0.35}; //für webgl angepasst
        posMutter = p.createVector(startMutter.x, startMutter.y);
        posKind = p.createVector(startKind.x, startKind.y);
        velMutter = p.createVector(0, 0);
        velKind = p.createVector(0, 0);
        fusionMeetPoint = p.createVector(0, 0);
    }

    function togglePause() {
        isPaused = !isPaused;
        pauseIndicator.style.display = isPaused ? "block" : "none";
    }

    function spawnFusionTarget() {
        const margin = 120;
        let x, y, attempts = 0;
        do {
            x = p.random(-p.width/2 + margin,p.width/2 - margin); //für webgl angepasst
            y = p.random(-p.height/2 + margin,p.height/2 - margin); //für webgl angepasst
            attempts++;
        } while (
            attempts < 30 &&
            (
                p.dist(x, y, startMutter.x, startMutter.y) < 200 ||
                p.dist(x, y, startKind.x, startKind.y) < 200
            )
            );
        fusionTarget = { x, y, z: 0 };
    }


    // ============================================================
    // p5 LIFECYCLE
    // ============================================================
    p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
        //pixelDensity(1);
        p.textFont(scoreFont); //für webgl angepasst
        // alpha range 0..1 so the original rgba values port over unchanged
        p.colorMode(p.RGB, 255, 255, 255, 1);
        p.blendMode(p.ADD);
        initPositions();

        if (!("serial" in navigator)) {
            connectButton.disabled = true;
            calibrateButton.disabled = true;
            serialStatus.textContent = "Web Serial fehlt";
        }
        connectButton.addEventListener("click", connectSerial);
        calibrateButton.addEventListener("click", calibrateJoysticks);
        spawnFusionTarget();
    };

    //für webgl angepasst
    p.preload = () => {
        scoreFont = p.loadFont(
            "https://cdnjs.cloudflare.com/ajax/libs/topcoat/0.8.0/font/SourceCodePro-Regular.otf"
        );
        //fusionShader = p.loadShader('vertexShaderCircle.vert','fragmentShaderCircle.frag');
    };

    p.windowResized = () => {
        // a resize event can fire before setup() initialised the state
        if (!posMutter || !posKind) return;
        p.resizeCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
        startMutter = {x: -p.width * 0.3,y: p.height * 0.35}; //WEBGL
        startKind = {x: p.width * 0.3,y: p.height * 0.35}; //WEBGL
        // keep emitters inside the new bounds (fixes off-screen drift on resize)
        posMutter.x = p.constrain(posMutter.x,-p.width/2 + CONFIG.margin,p.width/2 - CONFIG.margin);//WEBGL
        posMutter.y = p.constrain(posMutter.y,-p.height/2 + CONFIG.margin,p.height/2 - CONFIG.margin);//WEBGL
        posKind.x = p.constrain(posKind.x,-p.width/2 + CONFIG.margin,p.width/2 - CONFIG.margin);//WEBGL
        posKind.y = p.constrain(posKind.y,-p.height/2 + CONFIG.margin,p.height/2 - CONFIG.margin);//WEBGL
    };

    p.keyPressed = () => {
        audio.start();
        if (p.keyCode === p.ENTER) togglePause();
    };

    p.mousePressed = () => {
        audio.start();
    };
    // =============================================
    // Score-Anzeige
    // =============================================
    function drawScore() {
        drawScoreMutter();
        drawScoreKind();
    }

    function drawScoreMutter() {
        const cx = -p.width/2 + 70; //WEBGL
        const cy = p.height/2 - 70; //WEBGL
        drawScoreCircle(cx, cy, scoreMutter, p.HALF_PI);
    }

    function drawScoreKind() {
        p.push();
        p.translate(p.width/2 - 70,-p.height/2 + 70); //WEBGL
        p.rotate(p.PI);
        drawScoreCircle(0, 0, scoreKind, p.HALF_PI);
        p.pop();
    }

    function drawScoreCircle(cx, cy, score, numberRotation) {
        const R = 38;
        const segCount = SCORE_MAX;
        const gapAngle = 0.06;
        const arcPerSeg = (p.TWO_PI / segCount) - gapAngle;
        const startAngle = -p.HALF_PI;

        p.push();
        p.translate(cx, cy);

        // Hintergrund-Kreis
        p.noStroke();
        p.fill(10, 2, 18, 180);
        p.ellipse(0, 0, (R + 10) * 2, (R + 10) * 2);

        for (let i = 0; i < segCount; i++) {
            const segStart = startAngle + i * (p.TWO_PI / segCount) + gapAngle / 2;
            const segEnd = segStart + arcPerSeg;
            const filled = i < score;

            if (filled) {
                //p.drawingContext.shadowBlur = 12; //wird anscheinend von WEBGL ignoriert
                //p.drawingContext.shadowColor = "rgba(255,255,255,0.8)"; //wird anscheinend von WEBGL ignoriert
                p.stroke(255, 255, 255, 220);
                p.strokeWeight(4);
            } else {
                p.drawingContext.shadowBlur = 0;
                p.stroke(255, 255, 255, 45);
                p.strokeWeight(2);
            }

            p.noFill();
            p.arc(
                0,
                0,
                R * 2,
                R * 2,
                segStart,
                segEnd
            );
        }

        // Zahl in der Mitte
        p.drawingContext.shadowBlur = 0;
        p.push();
        p.rotate(numberRotation);
        p.noStroke();
        p.fill(255, 255, 255, 200);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(18);
        p.textStyle(p.BOLD);
        p.text(score, 0, 0);
        p.pop();

        p.pop();
    }

    // ============================================================
    // MAIN LOOP
    // ============================================================
    p.draw = () => {
        if (isPaused) return;
        const time = p.millis();
        const f = CONFIG.fusion;


        // semi-transparent fill leaves a fading trail of previous frames
        p.background(CONFIG.background[0], CONFIG.background[1], CONFIG.background[2], CONFIG.trailAlpha);
        // --- Score-Anzeige ---
        const serialActive = isSerialOpen && time - lastSerialAt < CONFIG.serialTimeout;

        if (fusionState === FusionState.FUSING) {
            posMutter.set(fusionMeetPoint.x, fusionMeetPoint.y);
            posKind.set(fusionMeetPoint.x, fusionMeetPoint.y);

            if (time - lastFusionBellTime > f.bellInterval) {
                audio.fusionBell();
                lastFusionBellTime = time;
            }
            if (time - fusionHoldStartTime > f.holdDuration) {
                fusionState = FusionState.RETURNING;
                returnStartTime = time;
                scoreMutter = Math.min(scoreMutter + 1, SCORE_MAX);
                scoreKind   = Math.min(scoreKind + 1, SCORE_MAX);
                spawnFusionTarget();
                if (scoreMutter >= SCORE_MAX) {
                    scoreMutter = 0;
                    scoreKind = 0;
                    particles = [];

                }
            }
        } else if (fusionState === FusionState.RETURNING) {
            const rp = Math.min(1.0, (time - returnStartTime) / f.returnDuration);
            posMutter.x = p.lerp(fusionMeetPoint.x, startMutter.x, rp);
            posMutter.y = p.lerp(fusionMeetPoint.y, startMutter.y, rp);
            posKind.x = p.lerp(fusionMeetPoint.x, startKind.x, rp);
            posKind.y = p.lerp(fusionMeetPoint.y, startKind.y, rp);
            if (rp >= 1.0) {
                fusionState = FusionState.FREE;
                fusionProgress = 0;
            }
        } else {
            // FREE — players control the emitters
            const cfgM = CONFIG.emitters.mutter;
            const cfgK = CONFIG.emitters.kind;
            const inputMutter = getInputVector("mutter", serialActive);
            const inputKind = getInputVector("kind", serialActive);

            moveEmitter(
                posMutter,
                velMutter,
                inputMutter,
                serialActive ? cfgM.accelSerial : cfgM.accelKeyboard,
                cfgM.drag,
                cfgM.maxSpeed,
            );
            moveEmitter(
                posKind,
                velKind,
                inputKind,
                serialActive ? cfgK.accelSerial : cfgK.accelKeyboard,
                cfgK.drag,
                cfgK.maxSpeed,
            );

            const mutterMotion = Math.hypot(inputMutter.x, inputMutter.y);
            const kindMotion = Math.hypot(inputKind.x, inputKind.y);
            motion.mutterActive = mutterMotion > CONFIG.inputThreshold;
            motion.kindActive = kindMotion > CONFIG.inputThreshold;
            /*
            if (!motion.mutterActive && !motion.kindActive) {
              if (time - lastAmbientTime > CONFIG.ambient.ringInterval) {
                ambientRings.push(new AmbientRing());
                lastAmbientTime = time;
              }
              if (time - lastAmbientSoundTime > CONFIG.ambient.soundInterval) {
                audio.ambientSwell();
                lastAmbientSoundTime = time;
              }
            } else if (ambientRings.length > 0) {
              ambientRings = [];
            } */

            if (motion.mutterActive && time - lastBeatMutter > 60000 / cfgM.bpm) {
                lastBeatMutter = time;
                triggerVibration(cfgM.vibration);
                playMotherHeartbeat();
            }
            if (motion.kindActive && time - lastBeatKind > 60000 / cfgK.bpm) {
                lastBeatKind = time;
                triggerVibration(cfgK.vibration);
                playChildHeartbeat();
            }

            const mutterInterval = Math.max(cfgM.ringIntervalMin, cfgM.ringIntervalBase - mutterMotion * cfgM.ringIntervalGain);
            const kindInterval = Math.max(cfgK.ringIntervalMin, cfgK.ringIntervalBase - kindMotion * cfgK.ringIntervalGain);
            if (motion.mutterActive && time - lastRingMutter > mutterInterval) {
                particles.push(new RingParticle(posMutter.x, posMutter.y, "mutter", fusionProgress));
                lastRingMutter = time;
            }
            if (motion.kindActive && time - lastRingKind > kindInterval) {
                particles.push(new RingParticle(posKind.x, posKind.y, "kind", fusionProgress));
                lastRingKind = time;
            }

            if (fusionTarget) {
                const distM = p.dist(posMutter.x, posMutter.y, fusionTarget.x, fusionTarget.y);
                const distK = p.dist(posKind.x,   posKind.y,   fusionTarget.x, fusionTarget.y);
                const bothNear = distM < CONFIG.fusion.FUSION_TRIGGER_DIST && distK < CONFIG.fusion.FUSION_TRIGGER_DIST;
                const dist = p.dist(posMutter.x, posMutter.y,posKind.x,posKind.y);
                if (bothNear) {
                    fusionProgress = p.min(1.0, fusionProgress + 0.035);
                } else {
                    fusionProgress = p.max(0,   fusionProgress - 0.04);
                }
            }
            if (fusionProgress >= 1.0) {
                fusionState = FusionState.FUSING;
                fusionHoldStartTime = time;
                lastFusionBellTime = time;
                fusionMeetPoint.set((posMutter.x + posKind.x) / 2, (posMutter.y + posKind.y) / 2);
                audio.fusionBell();
            }
        }

        for (let i = ambientRings.length - 1; i >= 0; i--) {
            ambientRings[i].update();
            ambientRings[i].draw();
            if (ambientRings[i].life <= 0) ambientRings.splice(i, 1);
        }
        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update();
            particles[i].draw();
            if (particles[i].life <= 0) particles.splice(i, 1);
        }
        if (fusionProgress > 0.05) {
            drawFusionTarget(time);
        }
        drawEmitterCore(posMutter, "mutter", time);
        drawEmitterCore(posKind, "kind", time);

        // fusion sphere — fade it out during the return so it no longer pops away
        let sphereIntensity = fusionProgress;
        if (fusionState === FusionState.RETURNING) {
            sphereIntensity = 1 - Math.min(1.0, (time - returnStartTime) / f.returnDuration);
        }
        if (sphereIntensity > 0 || fusionState !== FusionState.FREE) {
            const inFusion = fusionState !== FusionState.FREE;
            const cx = inFusion ? fusionMeetPoint.x : (posMutter.x + posKind.x) / 2;
            const cy = inFusion ? fusionMeetPoint.y : (posMutter.y + posKind.y) / 2;
            drawSphere(time, cx, cy, sphereIntensity);
        }
        drawScore();
        drawFusionTarget(time);
    };
};

new p5(sketch);
