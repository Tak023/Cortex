import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
console.log('loading fp32 ...');
const t0 = Date.now();
const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
  dtype: 'fp32',
});
console.log('loaded in', Date.now()-t0, 'ms');
// soft sine ~440Hz 1s as fake speech energy
const audio = new Float32Array(16000);
for (let i = 0; i < audio.length; i++) audio[i] = 0.2 * Math.sin(2*Math.PI*440*i/16000);
const out = await pipe(audio, { return_timestamps: false });
console.log('OK', JSON.stringify(out));
