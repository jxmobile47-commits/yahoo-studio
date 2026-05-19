"use client";

import { useState, useRef, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import Navigation from '@/components/common/Navigation';
import AnimatedTitle from '@/components/homepage/AnimatedTitle';
import HeroChordGridLyricsMock from '@/components/homepage/HeroChordGridLyricsMock';
import HeroPianoVisualizerMock from '@/components/homepage/HeroPianoVisualizerMock';
import HeroScrollingChordAnimation from '@/components/homepage/HeroScrollingChordAnimation';
import IntegratedSearchContainer from '@/components/homepage/LazyIntegratedSearchContainer';

import { useTheme } from '@/contexts/ThemeContext';
import { IoMusicalNotes, IoMusicalNote } from 'react-icons/io5';
import { useSearchBoxVisibility } from '@/hooks/ui/useSearchBoxVisibility';
import { useSharedSearchState } from '@/hooks/search/useSharedSearchState';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Chip } from '@heroui/react';
import { HiSparkles } from 'react-icons/hi2';
// import { WarningBanner } from '@/components/WarningBanner';
import SupportYahooStudio from '@/components/homepage/SupportChordMini'
import FeaturesTabSection from '@/components/homepage/FeaturesTabSection';

// Dynamic imports for heavy components
const RecentVideos = dynamic(() => import('@/components/homepage/LazyRecentVideos'), {
  loading: () => (
    <div className="w-full bg-content1 dark:bg-content1 border border-divider dark:border-divider rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider dark:border-divider">
        <div className="h-5 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </div>
      <div className="h-96 overflow-hidden p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="w-full bg-content2 dark:bg-content2 border border-divider dark:border-divider rounded-md">
              <div className="p-3">
                <div className="flex gap-3">
                  <div className="w-20 h-12 bg-gray-200 dark:bg-gray-700 rounded-md animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
  ssr: false
});

function NewHomePageContentInner() {
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Track when component has mounted to prevent hydration mismatch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Scroll-based animations
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.3], [1, 0]);
  // const heroScale = useTransform(scrollYProgress, [0, 0.3], [1, 0.95]);

  // Use shared search state for synchronization between main and sticky search
  const {
    searchQuery,
    searchResults,
    isSearching,
    searchError,
    updateSearchQuery,
    handleSearch,
    handleVideoSelect,
    setSearchError
  } = useSharedSearchState();
  const shouldHideHeroMarquee = isSearching || searchResults.length > 0;

  // Search box visibility detection for sticky search bar
  const { elementRef: searchBoxRef, shouldShowStickySearch } = useSearchBoxVisibility();

  // Handle URL query parameters for search
  useEffect(() => {
    const query = searchParams.get('q');
    if (query && query !== searchQuery) {
      updateSearchQuery(query);
    }
  }, [searchParams, searchQuery, updateSearchQuery]);

  return (
    <div className="relative flex flex-col min-h-screen transition-colors duration-300">
      <div className="fixed inset-0 z-0 h-screen pointer-events-none">
        {theme === 'dark' ? (
          <div className="h-full w-full bg-black relative">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(70% 55% at 50% 50%, #2a5d77 0%, #184058 18%, #0f2a43 34%, #0a1b30 50%, #071226 66%, #040d1c 80%, #020814 92%, #01040d 97%, #000309 100%), radial-gradient(160% 130% at 10% 10%, rgba(0,0,0,0) 38%, #000309 76%, #000208 100%), radial-gradient(160% 130% at 90% 90%, rgba(0,0,0,0) 38%, #000309 76%, #000208 100%)"
              }}
            />
          </div>
        ) : (
          <div className="h-full w-full relative bg-background overflow-hidden">
            <div
              className="absolute inset-0 z-0"
              style={{
                background: "#faf6ee",
                backgroundImage: `
                  radial-gradient(
                    circle at top center,
                    rgba(70, 130, 180, 0.5),
                    transparent 70%
                  )
                `,
                filter: "blur(80px)",
                backgroundRepeat: "no-repeat",
              }}
            />
          </div>
        )}
      </div>

      {/* Navigation */}
      <Navigation showStickySearch={shouldShowStickySearch} overlay />


      {/* <WarningBanner /> */}

      
      {/* Hero Section - Adjusted for navigation bar visibility */}
      <motion.section
        style={{
          opacity: heroOpacity,
          // scale: heroScale,
          minHeight: 'calc(100vh - 20px)',
        }}
        className="relative z-10 flex items-start justify-center overflow-hidden bg-transparent"
      >
        {/* Decorative Music Notes - Only show after hydration to prevent mismatch */}
        {mounted && (
          <>
            <IoMusicalNote className="absolute top-8 left-8 w-8 h-8 text-gray-600 dark:text-gray-300 opacity-50 dark:opacity-70 z-10" />
            <IoMusicalNotes className="absolute top-8 right-8 w-12 h-12 text-gray-600 dark:text-gray-300 opacity-50 dark:opacity-70 z-10" />
          </>
        )}

        {/* Split-Screen Layout */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12 items-center pt-24 pb-20 lg:pb-24">
          {/* Left Side: Hero Content (60%) */}
          <div className="lg:col-span-3 space-y-8">
            {/* Title - Centered */}
            <div ref={titleRef} className="text-center">
              <AnimatedTitle text="Chord Mini" className="mb-3" />
              <div className="min-h-[2rem] flex items-center justify-center mt-2">
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    delay: 0.3,
                    duration: 0.8,
                    ease: "easeOut",
                  }}
                  className="text-base md:text-lg text-slate-600 dark:text-gray-200 font-normal tracking-wide text-center leading-relaxed max-w-lg mx-auto"
                >
                  Open source chord & beat detection application. Get your favorite songs transcribed!
                </motion.p>
              </div>
            </div>

            {/* Search Container - Above guitar chord animation */}
            <IntegratedSearchContainer
              searchQuery={searchQuery}
              setSearchQuery={updateSearchQuery}
              handleSearch={handleSearch}
              isSearching={isSearching}
              searchError={searchError}
              error={error}
              setError={setError}
              setSearchError={setSearchError}
              searchResults={searchResults}
              handleVideoSelect={handleVideoSelect}
              containerRef={searchBoxRef}
            />

            {/* Hide the marquee while the search panel is active to prevent hero layout shift. */}
            {!shouldHideHeroMarquee && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.05, duration: 0.6 }}
                className="flex justify-center"
              >
                <HeroScrollingChordAnimation className="w-full max-w-6xl" />
              </motion.div>
            )}
          </div>

          {/* Right Side: Demo Images (40%) */}
          <div className="lg:col-span-2">
            <div className="space-y-4">
              <div className="space-y-3">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15, duration: 0.45 }}
                >
                  <HeroChordGridLyricsMock />
                  <div className="p-3">
                    <h4 className="font-medium text-gray-800 dark:text-gray-100 mb-1 text-sm">Beat & Chord Analysis & Lyrics</h4>
                    <p className="text-xs text-gray-600 dark:text-gray-300">Progressions with Roman numeral analysis, key changes, and sync lyrics</p>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.25, duration: 0.45 }}
                >
                  <HeroPianoVisualizerMock />
                  <div className="p-3">
                    <h4 className="font-medium text-gray-800 dark:text-gray-100 mb-1 text-sm">Piano Visualizer</h4>
                    <p className="text-xs text-gray-600 dark:text-gray-300">Falling notes visualization with multi-instrument support and MIDI export</p>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35, duration: 0.45 }}
                >
                  <a href="/vocal-synth" className="block group">
                    <div className="rounded-xl border border-pink-200/60 dark:border-pink-900/30 bg-gradient-to-br from-pink-50 to-purple-50 dark:from-pink-950/20 dark:to-purple-950/20 overflow-hidden p-3 transition-all hover:shadow-md hover:border-pink-300 dark:hover:border-pink-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
                        <span className="text-xs font-semibold text-pink-700 dark:text-pink-300 uppercase tracking-wide">Vocal Synth</span>
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-pink-100 dark:bg-pink-900/40 text-pink-600 dark:text-pink-300">New</span>
                      </div>
                      <div className="relative h-20 bg-white/50 dark:bg-black/20 rounded-lg overflow-hidden">
                        {/* Mini piano roll preview */}
                        <svg viewBox="0 0 160 60" className="w-full h-full opacity-70">
                          {[0, 1, 2, 3, 4].map(i => (
                            <line key={i} x1={0} y1={i * 12} x2={160} y2={i * 12} stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeWidth={0.5} />
                          ))}
                          {Array.from({length:9},(_,i)=>({x:i*18,w:14,p:i})).map((n,i)=>[
                            <rect key={`r${i}`} x={n.x+2} y={24 - i*2} width={n.w} height={10} rx={2} fill="#ec4899" opacity={0.6 + i*0.04} />,
                            <text key={`t${i}`} x={n.x+5} y={32 - i*2} fontSize="6" fill="white">{['き','ら','き','ら','ひ','か','る','よ','る'][i]}</text>
                          ])}
                        </svg>
                      </div>
                    </div>
                    <div className="p-3">
                      <h4 className="font-medium text-gray-800 dark:text-gray-100 mb-1 text-sm group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">Vocal Synth Studio</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-300">OpenUtau-inspired singing synthesis — draw notes, add lyrics, play back instantly</p>
                    </div>
                  </a>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.45, duration: 0.45 }}
                >
                  <a href="/stem-separation" className="block group">
                    <div className="rounded-xl border border-cyan-200/60 dark:border-cyan-900/30 bg-gradient-to-br from-cyan-50 to-teal-50 dark:from-cyan-950/20 dark:to-teal-950/20 overflow-hidden p-3 transition-all hover:shadow-md hover:border-cyan-300 dark:hover:border-cyan-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                        <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">Stem Sep</span>
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-300">New</span>
                      </div>
                      <div className="relative h-20 bg-white/50 dark:bg-black/20 rounded-lg overflow-hidden">
                        <svg viewBox="0 0 160 60" className="w-full h-full opacity-70">
                          {Array.from({length:6},(_,i)=>[
                            <rect key={`r${i}`} x={0} y={i*10} width={160} height={8} rx={2} fill={['#f43f5e','#f59e0b','#10b981','#3b82f6','#a855f7','#6b7280'][i]} opacity={0.25} />,
                            <rect key={`b${i}`} x={i*20+5} y={i*10+1} width={30+i*5} height={6} rx={2} fill={['#f43f5e','#f59e0b','#10b981','#3b82f6','#a855f7','#6b7280'][i]} opacity={0.6} />
                          ])}
                        </svg>
                      </div>
                    </div>
                    <div className="p-3">
                      <h4 className="font-medium text-gray-800 dark:text-gray-100 mb-1 text-sm group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">Stem Separation Studio</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-300">StemDeck-inspired audio splitting — isolate vocals, drums, bass, piano & guitar</p>
                    </div>
                  </a>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.55, duration: 0.45 }}
                >
                  <a href="/beat-maker" className="block group">
                    <div className="rounded-xl border border-green-200/60 dark:border-green-900/30 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 overflow-hidden p-3 transition-all hover:shadow-md hover:border-green-300 dark:hover:border-green-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-xs font-semibold text-green-700 dark:text-green-300 uppercase tracking-wide">Beat Maker</span>
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300">New</span>
                      </div>
                      <div className="relative h-20 bg-white/50 dark:bg-black/20 rounded-lg overflow-hidden">
                        <svg viewBox="0 0 160 60" className="w-full h-full opacity-70">
                          {Array.from({length:4},(_,i)=>[
                            <rect key={`r${i}`} x={0} y={i*14+2} width={160} height={10} rx={2} fill={['#E57373','#FFB74D','#FFF176','#BA68C8'][i]} opacity={0.15} />,
                            Array.from({length:16},(_,j)=><rect key={`s${i}-${j}`} x={j*10} y={i*14+3} width={8} height={8} rx={1} fill={['#E57373','#FFB74D','#FFF176','#BA68C8'][i]} opacity={([0,4,8,12].includes(j)||(i===1&&(j===4||j===12))||(i===2&&j%2===0)||(i===3&&(j===4||j===12)))?0.7:0.1} />)
                          ])}
                        </svg>
                      </div>
                    </div>
                    <div className="p-3">
                      <h4 className="font-medium text-gray-800 dark:text-gray-100 mb-1 text-sm group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">Beat Maker Studio</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-300">ADTLib-inspired drum transcription — auto-detect onsets & create beats</p>
                    </div>
                  </a>
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Recent Videos Section - Light source in the center */}
      <section className="relative z-20 -mt-10 w-full overflow-hidden rounded-[36px] border border-slate-200/80 bg-gray-50 py-16 shadow-[0_-24px_80px_rgba(15,23,42,0.08)] transition-colors duration-300 dark:border-white/10 dark:bg-slate-900 min-h-[33vh]">
        {/* Background Gradient */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          {theme === 'dark' ? (
            <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.15) 0%, transparent 60%)` }} />
          ) : (
            <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 50%, rgba(255, 235, 59, 0.2) 0%, transparent 70%)` }} />
          )}
        </div>
        
        {/* Content */}
        <div className="relative z-10 max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Recent Analyses
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
              Explore recently analyzed songs and discover new music through our community
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <RecentVideos />
          </motion.div>
        </div>
      </section>

      {/* Features Section - Tab-based design */}
      <FeaturesTabSection />

      {/* Animated Support Section - Diffuse glow */}
      <section className="relative z-20 mx-0 w-full overflow-hidden rounded-t-[36px] border border-slate-200/80 bg-gray-50 py-20 shadow-[0_24px_80px_rgba(15,23,42,0.08)] transition-colors duration-300 dark:border-white/10 dark:bg-slate-900">
        {/* Background Gradient */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          {theme === 'dark' ? (
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 0%, rgba(70, 85, 110, 0.2) 0%, transparent 70%)` }} />
          ) : (
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(255, 167, 38, 0.1) 0%, transparent 50%)` }} />
          )}
        </div>

        {/* Content */}
        <div className="relative z-10 max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12 items-start">
            {/* Left Column: Description (40%) */}
            <div className="lg:col-span-2 lg:text-left">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <h3 className="text-lg font-medium flex items-center gap-2 text-gray-900 dark:text-white">
                  <HiSparkles className="w-5 h-5 text-primary" />
                  Support Yahoo Studio
                </h3>
                <Chip size="sm" variant="flat" color="success">
                  Open Source
                </Chip>

                <p className="text-md text-gray-700 dark:text-gray-200 leading-relaxed">
                  Yahoo Studio is a free, open-source project. The backend server is not guaranteed to be maintained and running for extended periods due to budget constraints. We try our best to keep it running and add new features/models. If you&apos;d like to support the project to keep the backend server running, you can use the donation link. We really appreciate your support! <br />
                  <em className="text-sm">Note: current server is CPU-based computation, GPU acceleration is more than 10 times faster.</em>
                  <br />
                  <em className="text-sm">You can always clone/self-host the app from the source code and deploy it on your own server.</em>
                </p>
              </motion.div>
            </div>

            {/* Right Column: Support Actions and Research Project (60%) */}
            <div className="lg:col-span-3 w-full">
              <motion.div
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, delay: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="space-y-6 w-full"
              >
                <SupportYahooStudio />
              </motion.div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function NewHomePageContent() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-dark-bg" />}>
      <NewHomePageContentInner />
    </Suspense>
  );
}
