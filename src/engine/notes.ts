export const appendNotes = (existingNotes: string | null | undefined, additions: string[]) => {
  const existing = (existingNotes || "")
    .split(/[،,]/)
    .map((note) => note.trim())
    .filter(Boolean);
  const set = new Set(existing);
  additions.forEach((note) => set.add(note));
  return Array.from(set).join("، ");
};

export const composeDailyNotes = ({
  baseNotes,
  extraNotes,
  leaveNotes,
  hasOvernightStay,
}: {
  baseNotes?: string | null;
  extraNotes: string[];
  leaveNotes: string[];
  hasOvernightStay: boolean;
}) => {
  if (hasOvernightStay) return "مبيت";
  return appendNotes(baseNotes, [...extraNotes, ...leaveNotes]);
};

export const computeAutomaticNotes = ({
  existingNotes,
  checkInExists,
  checkOutExists,
  missingStampExcused,
  earlyLeaveExcused,
  checkOutBeforeEarlyLeave,
}: {
  existingNotes?: string | null;
  checkInExists: boolean;
  checkOutExists: boolean;
  missingStampExcused: boolean;
  earlyLeaveExcused: boolean;
  checkOutBeforeEarlyLeave: boolean;
}) => {
  const notes: string[] = [];
  if (checkInExists && !checkOutExists && !missingStampExcused) {
    notes.push("سهو بصمة");
  }
  if (!checkInExists && checkOutExists && !missingStampExcused) {
    notes.push("سهو بصمة دخول");
  }
  if (checkOutExists && checkOutBeforeEarlyLeave && !earlyLeaveExcused) {
    notes.push("انصراف مبكر");
  }
  return appendNotes(existingNotes, notes);
};

