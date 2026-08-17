/**
 * Build a Large Language Model (From Scratch) — official code from
 * https://github.com/rasbt/LLMs-from-scratch (Sebastian Raschka / Manning).
 */
import type { CourseUnit } from "./types";

export const LLMS_FROM_SCRATCH_GITHUB =
  "https://github.com/rasbt/LLMs-from-scratch";
export const LLMS_FROM_SCRATCH_BOOK =
  "https://www.manning.com/books/build-a-large-language-model-from-scratch";
export const LLMS_FROM_SCRATCH_VIDEO =
  "https://www.manning.com/livevideo/master-and-build-large-language-models";
export const LLMS_FROM_SCRATCH_SETUP =
  "https://github.com/rasbt/LLMs-from-scratch/blob/main/setup/README.md";

export function llmsFromScratchUrl(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (!clean) return LLMS_FROM_SCRATCH_GITHUB;
  const kind = /\.[a-z0-9]+$/i.test(clean) ? "blob" : "tree";
  return `${LLMS_FROM_SCRATCH_GITHUB}/${kind}/main/${clean}`;
}

export const LLMS_FROM_SCRATCH_UNITS: CourseUnit[] = [
  {
    id: "setup",
    label: "Setup",
    title: "Python environment",
    description: "Install Python, packages, and optional Docker before chapter 1.",
    lessons: [
      { slug: "setup/README.md", title: "Setup recommendations" },
      {
        slug: "setup/02_installing-python-libraries",
        title: "Installing Python packages",
      },
      {
        slug: "setup/03_optional-docker-environment",
        title: "Optional Docker environment",
      },
      { slug: "troubleshooting.md", title: "Troubleshooting guide" },
    ],
  },
  {
    id: "ch01",
    label: "Ch 1",
    title: "Understanding Large Language Models",
    description: "What LLMs are and how this book builds one. No code.",
    lessons: [{ slug: "ch01", title: "Chapter 1 notes" }],
  },
  {
    id: "ch02",
    label: "Ch 2",
    title: "Working with Text Data",
    description: "Tokenization, embeddings, and the PyTorch dataloader.",
    lessons: [
      { slug: "ch02/01_main-chapter-code/ch02.ipynb", title: "Main notebook" },
      {
        slug: "ch02/01_main-chapter-code/dataloader.ipynb",
        title: "Dataloader summary",
      },
      {
        slug: "ch02/01_main-chapter-code/exercise-solutions.ipynb",
        title: "Exercise solutions",
      },
      { slug: "ch02", title: "All chapter files" },
    ],
  },
  {
    id: "ch03",
    label: "Ch 3",
    title: "Coding Attention Mechanisms",
    description: "Self-attention and multi-head attention from scratch.",
    lessons: [
      { slug: "ch03/01_main-chapter-code/ch03.ipynb", title: "Main notebook" },
      {
        slug: "ch03/01_main-chapter-code/multihead-attention.ipynb",
        title: "Multi-head attention summary",
      },
      {
        slug: "ch03/01_main-chapter-code/exercise-solutions.ipynb",
        title: "Exercise solutions",
      },
      { slug: "ch03", title: "All chapter files" },
    ],
  },
  {
    id: "ch04",
    label: "Ch 4",
    title: "Implementing a GPT Model from Scratch",
    description: "Assemble the GPT architecture in PyTorch.",
    lessons: [
      { slug: "ch04/01_main-chapter-code/ch04.ipynb", title: "Main notebook" },
      { slug: "ch04/01_main-chapter-code/gpt.py", title: "gpt.py summary" },
      {
        slug: "ch04/01_main-chapter-code/exercise-solutions.ipynb",
        title: "Exercise solutions",
      },
      { slug: "ch04", title: "All chapter files" },
    ],
  },
  {
    id: "ch05",
    label: "Ch 5",
    title: "Pretraining on Unlabeled Data",
    description: "Train the model, generate text, and load pretrained weights.",
    lessons: [
      { slug: "ch05/01_main-chapter-code/ch05.ipynb", title: "Main notebook" },
      { slug: "ch05/01_main-chapter-code/gpt_train.py", title: "gpt_train.py" },
      {
        slug: "ch05/01_main-chapter-code/gpt_generate.py",
        title: "gpt_generate.py",
      },
      {
        slug: "ch05/01_main-chapter-code/exercise-solutions.ipynb",
        title: "Exercise solutions",
      },
      { slug: "ch05", title: "All chapter files" },
    ],
  },
  {
    id: "ch06",
    label: "Ch 6",
    title: "Finetuning for Text Classification",
    description: "Classify text by finetuning the pretrained GPT.",
    lessons: [
      { slug: "ch06/01_main-chapter-code/ch06.ipynb", title: "Main notebook" },
      {
        slug: "ch06/01_main-chapter-code/gpt_class_finetune.py",
        title: "gpt_class_finetune.py",
      },
      {
        slug: "ch06/01_main-chapter-code/exercise-solutions.ipynb",
        title: "Exercise solutions",
      },
      { slug: "ch06", title: "All chapter files" },
    ],
  },
  {
    id: "ch07",
    label: "Ch 7",
    title: "Finetuning to Follow Instructions",
    description: "Instruction-finetune the model so it follows prompts.",
    lessons: [
      { slug: "ch07/01_main-chapter-code/ch07.ipynb", title: "Main notebook" },
      {
        slug: "ch07/01_main-chapter-code/gpt_instruction_finetuning.py",
        title: "Instruction-finetuning script",
      },
      {
        slug: "ch07/01_main-chapter-code/ollama_evaluate.py",
        title: "Ollama evaluation",
      },
      {
        slug: "ch07/01_main-chapter-code/exercise-solutions.ipynb",
        title: "Exercise solutions",
      },
      { slug: "ch07", title: "All chapter files" },
    ],
  },
  {
    id: "appendices",
    label: "Appendix",
    title: "PyTorch, exercises, LoRA",
    description: "PyTorch intro, solutions, training extras, and LoRA finetuning.",
    lessons: [
      {
        slug: "appendix-A/01_main-chapter-code/code-part1.ipynb",
        title: "A · PyTorch part 1",
      },
      {
        slug: "appendix-A/01_main-chapter-code/code-part2.ipynb",
        title: "A · PyTorch part 2",
      },
      { slug: "appendix-B", title: "B · References" },
      { slug: "appendix-C", title: "C · Exercise solutions" },
      {
        slug: "appendix-D/01_main-chapter-code/appendix-D.ipynb",
        title: "D · Training-loop extras",
      },
      {
        slug: "appendix-E/01_main-chapter-code/appendix-E.ipynb",
        title: "E · LoRA finetuning",
      },
    ],
  },
];
