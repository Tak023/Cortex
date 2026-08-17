export type CourseLesson = {
  slug: string;
  title: string;
};

export type CourseUnit = {
  id: string;
  label: string;
  title: string;
  description: string;
  lessons: CourseLesson[];
};
