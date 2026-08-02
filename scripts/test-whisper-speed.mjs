import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;

async function bench(label, opts) {
  const t0 = Date.now();
  console.log('load', label, '...');
  let pipe;
  try {
    pipe = await pipeline('automatic-speech-recognition', opts.model, {
      dtype: opts.dtype,
      device: opts.device,
    });
  } catch (e) {
    console.log('LOAD FAIL', label, e.message);
    return;
  }
  console.log('loaded', label, Date.now()-t0, 'ms');
  // 3s of soft audio
  const audio = new Float32Array(16000 * 3);
  for (let i = 0; i < audio.length; i++) audio[i] = 0.15 * Math.sin(2*Math.PI*220*i/16000);
  const t1 = Date.now();
  try {
    const out = await pipe(audio, { return_timestamps: false });
    console.log('infer', label, Date.now()-t1, 'ms', JSON.stringify(out).slice(0,80));
  } catch (e) {
    console.log('INFER FAIL', label, e.message);
  }
}

await bench('fp32-default', { model: 'Xenova/whisper-tiny.en', dtype: 'fp32' });
await bench('q4', { model: 'Xenova/whisper-tiny.en', dtype: 'q4' });
await bench('q8', { model: 'Xenova/whisper-tiny.en', dtype: 'q8' });
await bench('fp16', { model: 'Xenova/whisper-tiny.en', dtype: 'fp16' });
