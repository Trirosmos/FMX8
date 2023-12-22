var newMessage = false;
var message = 0;

var operatorAllocation = [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1];
var midiChannelPatch = [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1];

let messages = [];

let sinLUT = [];
let expLUT = [];

function initLUTs() {
    //80 dB of dynamic range in 4096 steps -> Ratio of 10000
    //0.01953125 dB per step -> Ratio of 1.0022511482929128 between adjacent steps
    expLUT[0] = 0;
    expLUT[1] = 1 / 1e4;

    for(let i = 2; i < 4096; i++) {
        expLUT[i] = expLUT[i - 1] * 1.0022511482929128;
    }

    for(let i = 0; i < 4096; i++) {
        expLUT[i] = fp(expLUT[i]);
    }

    for(let i = 0; i < 4096; i++) {
        let step = (1 / 4096) * i;
        let angle = ((2 * Math.PI) * step) + (Math.PI / 180);
        sinLUT[i] = fp(Math.sin(angle));
    }
}

function fp(valor) {
    return Math.round(valor * 65536);
}

function fpmul(l, r) {
    return Math.round((l * r) / 65536);
}

function getEXP(value) {
    return expLUT[fpmul(value, 4096)];
}

function getSIN(value) {
    return sinLUT[(value & fp(4095)) >> 16];
}

function runEG(eg) {
    switch(eg.state) {
        case 0:
            eg.out += eg.a;
            if(eg.out >= fp(1)) {
                eg.out = fp(1);
                eg.state++;
            }
        break;
        case 1:
            eg.out -= eg.d;
            if(eg.out <= eg.s) {
                eg.out = eg.s;
                eg.state++;
            }
        break;
        case 3:
            eg.out -= eg.d;
            if(eg.out < fp(0)) {
                eg.out = fp(0);
                eg.state++;
            }
        break;
    }
}

function getEG() {
    let eg = {
        state: 3,
        a: fp(0.001),
        d: fp(0.00001),
        s: fp(0.2),
        r: fp(0.01),
        out: 0
    };

    return eg;
}

function runOSCs(voice) {
    let oscOUTS = [];
    let outAccum = 0;

    for(let o = 0; o < 8; o ++) {
        let phase = voice.oscs[o].phaseAccum;
        for(let m = 0; m < 8; m++) {
            let mod;
            if(m !== o) mod = fpmul(voice.oscs[m].lastOut, voice.oscs[o].mod[m]);
            else mod = fpmul((voice.oscs[m].lastOut + voice.oscs[m].out), voice.oscs[o].mod[m]);
            phase += mod;
        }

        oscOUTS[o] = fpmul(getSIN(phase), voice.oscs[o].eg.out);
        outAccum += fpmul(oscOUTS[o], voice.oscs[o].vol);
        voice.oscs[o].phaseAccum += voice.oscs[o].angVel;
        voice.oscs[o].phaseAccum &= (fp(4095) | 65535);
    }

    for(let o = 0; o < 8; o++) {
        voice.oscs[o].lastOut = voice.oscs[o].out;
        voice.oscs[o].out = oscOUTS[o];
    }

    for(let o = 0; o < 8; o++) {
        runEG(voice.oscs[o].eg);
    }

    return outAccum / 65536;
}

function getOSC() {
    let OSC = {
        mod: [0,0,0,0,0,0,0,0],
        out: 0,
        lastOut: 0,
        phaseAccum: 0,
        angVel: 0,
        vol: 0,
        eg: getEG()
    };

    return OSC;
}

function getVoice() {
    let voice = {
        oscs: []
    };

    for(let x = 0; x < 8; x++) {
        voice.oscs.push(getOSC());
    }

    return voice;
}

function noteOn(voice) {
    for(let o = 0; o < 8; o++) {
        voice.oscs[o].eg.state = 0;
        voice.oscs[o].eg.out = 0;
    }
}

function noteOff(voice) {
    for(let o = 0; o < 8; o++) {
        voice.oscs[o].eg.state = 3;
    }
}

function freqToVel(freq) {
    let oneHz = (4096 / sampleRate);
    let val = freq * oneHz;

    //console.log(val, fp(val) / 65536);

    return fp(val);
}

var bla = getVoice();
bla.oscs[1].angVel = freqToVel(445);
bla.oscs[0].angVel = freqToVel(445);
bla.oscs[0].vol = fp(1);
bla.oscs[0].mod[0] = fp(600);
bla.oscs[0].mod[1] = fp(1024);

bla.oscs[0].eg.a = fp(0.01);
bla.oscs[0].eg.d = fp(0.00001);


//bla.oscs[0].eg.d = 0.01;

initLUTs();

class fmSynth extends AudioWorkletProcessor {
  constructor() {
    super();

    this.port.onmessage = function(e) {
        messages.push(e.data);
    }
  }

  process(inputs, outputs, parameters) {
    var chan0 = outputs[0][0];

    for(let x = 0; x < chan0.length; x++) {
        chan0[x] = runOSCs(bla);
    }
      
    while(messages.length > 0) {
        let m = messages[0];
        if(m.type === "noteOn") {
            noteOn(bla);

            bla.oscs[0].angVel = freqToVel(110 * Math.pow(Math.pow(2, 1 / 12), m.value) * Math.pow(Math.pow(2, 1 / 12), -9));
            bla.oscs[1].angVel = freqToVel((110 / 2) * Math.pow(Math.pow(2, 1 / 12), m.value) * Math.pow(Math.pow(2, 1 / 12), -9));

            //console.log(bla.oscs[0].angVel);
        }

        if(m.type === "noteOff") {
            noteOff(bla);
        }

        messages.splice(0, 1);
    }
      
    return true;
  }
}

registerProcessor('fmSynth', fmSynth);
