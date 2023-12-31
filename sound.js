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
    let product = fpmul(fp(value), 4096);
    let min = Math.min(product, fp(4095));
    let max = Math.max(min, 0);
    return expLUT[max >> 16];
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
                console.log("Decay");
            }
        break;
        case 1:
            eg.out -= eg.d;
            if(eg.out <= eg.s) {
                eg.out = eg.s;
                eg.state++;
                console.log("Sustain");
            }
        break;
        case 3:
            eg.out -= eg.r;
            if(eg.out < fp(0)) {
                eg.out = fp(0);
                eg.state++;
                console.log("Released");
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

    let oscAmount = 8;

    for(let o = 0; o < oscAmount; o ++) {
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

    for(let o = 0; o < oscAmount; o++) {
        voice.oscs[o].lastOut = voice.oscs[o].out;
        voice.oscs[o].out = oscOUTS[o];
    }

    if(voice.egCounter === 7) {
        for(let o = 0; o < oscAmount; o++) {
            runEG(voice.oscs[o].eg);
        }
        voice.egCounter = 0;
    }
    else voice.egCounter++;

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
        oscs: [],
        egCounter: 0,
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
        voice.oscs[o].eg.out = voice.oscs[o].eg.s;
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
bla.oscs[0].mod[1] = fp(2048);
bla.oscs[0].mod[2] = fp(600);
bla.oscs[0].mod[3] = fp(600);

bla.oscs[0].eg.a = fp(1);
bla.oscs[0].eg.d = fp(0.00001);

//bla.oscs[1].eg.a = fp(0.000005);
//bla.oscs[1].eg.d = fp(0.00001);


//bla.oscs[0].eg.d = 0.01;

initLUTs();

let currentNote = 0;

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

      messages.sort(function (a, b) {
          if(a.time < b.time) return -1;
          if(a.time > b.time) return 1;
          else return 0;
      });
      
    while(messages.length > 0) {
        let m = messages[0];
        if(m.type === "noteOn") {
            noteOn(bla);

            bla.oscs[0].angVel = freqToVel(440 * Math.pow(Math.pow(2, 1 / 12), m.value) * Math.pow(Math.pow(2, 1 / 12), -9));
            bla.oscs[1].angVel = freqToVel((440 / 2) * Math.pow(Math.pow(2, 1 / 12), m.value) * Math.pow(Math.pow(2, 1 / 12), -9));
            bla.oscs[2].angVel = freqToVel(435 * Math.pow(Math.pow(2, 1 / 12), m.value) * Math.pow(Math.pow(2, 1 / 12), -9));
            bla.oscs[3].angVel = freqToVel(445 * Math.pow(Math.pow(2, 1 / 12), m.value) * Math.pow(Math.pow(2, 1 / 12), -9));

            currentNote = m.value;

            //console.log(bla.oscs[0].angVel);
        }

        if(m.type === "noteOff") {
            if(m.value == currentNote) noteOff(bla);
        }

        if(m.type === "paramChange")
        {
            switch(m.param) {
                case "a":
                    bla.oscs[m.channel].eg.a = getEXP(fp(m.value)) + 1;
                    break;
                
                case "d":
                        bla.oscs[m.channel].eg.d = getEXP(fp(m.value / 3.5));
                break;
                
                case "s":
                        bla.oscs[m.channel].eg.s = getEXP(fp(m.value));
                break;
                
                case "r":
                        bla.oscs[m.channel].eg.r = getEXP(fp(m.value)) + 1;
                break;
            }

            console.log(bla.oscs[0].eg);
        }

        messages.splice(0, 1);
    }
      
    return true;
  }
}

registerProcessor('fmSynth', fmSynth);
