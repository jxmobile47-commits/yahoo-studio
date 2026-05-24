import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Chord Detection',
  description: 'The piano roll workspace has been retired. Use AI chord detection panels instead.',
};

export default function PianoRollPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#101626] px-6 text-center text-slate-200">
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold tracking-wide">Piano Roll feature has been retired</h1>
        <p className="text-sm text-slate-400">
          The interactive piano roll & chord grid workspace is no longer available. Please use the AI chord detection
          tools on the Analyze page to review detected chords in real time.
        </p>
      </div>
    </div>
  );
}
