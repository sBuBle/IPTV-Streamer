import { h } from 'preact';
import { Info, Mail, Shield, AlertTriangle, BookOpen, Heart, Code, Database, EyeOff, Globe, GitBranch, ArrowDown, Monitor, Tv, Lock, FileText, Scale } from 'lucide-preact';
import { useState } from 'preact/hooks';

export default function About() {
  const [activeTab, setActiveTab] = useState('about');
  
  return (
    <div>
      {/* Hero section with app info */}
      <div className="relative bg-gradient-to-br from-blue-900 to-gray-800 rounded-xl p-8 mb-8 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10">
            <Tv className="w-40 h-40 text-white" />
          </div>
          <div className="absolute bottom-10 right-10 transform rotate-12">
            <Globe className="w-32 h-32 text-white" />
          </div>
        </div>

        <div className="relative z-10">
          <h1 className="text-4xl font-bold mb-3">IPTV Streamer</h1>
          <p className="text-xl text-gray-300 max-w-2xl">
            A modern, lightweight web application for accessing and managing publicly available IPTV channels
          </p>
          <div className="flex flex-wrap gap-4 mt-6">
            <div className="bg-blue-800/40 px-4 py-2 rounded-full flex items-center gap-2 backdrop-blur-sm">
              <Code className="w-4 h-4" />
              <span>Open Source</span>
            </div>
            <div className="bg-green-800/40 px-4 py-2 rounded-full flex items-center gap-2 backdrop-blur-sm">
              <Monitor className="w-4 h-4" />
              <span>Cross-platform</span>
            </div>
            <div className="bg-purple-800/40 px-4 py-2 rounded-full flex items-center gap-2 backdrop-blur-sm">
              <Database className="w-4 h-4" />
              <span>Privacy-focused</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-gray-700 mb-8 overflow-x-auto">
        <button 
          onClick={() => setActiveTab('about')} 
          className={`px-5 py-3 font-medium whitespace-nowrap flex items-center gap-2 ${activeTab === 'about' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-300'}`}
        >
          <Info className="w-4 h-4" />
          About
        </button>
        <button 
          onClick={() => setActiveTab('features')} 
          className={`px-5 py-3 font-medium whitespace-nowrap flex items-center gap-2 ${activeTab === 'features' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-300'}`}
        >
          <Globe className="w-4 h-4" />
          Features
        </button>
        <button 
          onClick={() => setActiveTab('technical')} 
          className={`px-5 py-3 font-medium whitespace-nowrap flex items-center gap-2 ${activeTab === 'technical' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-300'}`}
        >
          <Code className="w-4 h-4" />
          Technical
        </button>
        <button 
          onClick={() => setActiveTab('legal')} 
          className={`px-5 py-3 font-medium whitespace-nowrap flex items-center gap-2 ${activeTab === 'legal' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-300'}`}
        >
          <Shield className="w-4 h-4" />
          Legal
        </button>
      </div>

      {/* Tab content */}
      <div className="tab-content">
        {/* About tab */}
        {activeTab === 'about' && (
          <div>
            <div className="grid gap-8 md:grid-cols-2">
              <div className="bg-gray-800 p-6 rounded-lg hover:bg-gray-750 transition-colors">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-500" />
                  About The Application
                </h3>
                <div className="space-y-4 text-gray-300">
                  <p>
                    IPTV Streamer is a web-based application for organizing and watching publicly available IPTV channels. It allows you to add M3U8 playlists, organize channels by country and category, and create your own favorites collection.
                  </p>
                  <p>
                    This application runs entirely in your browser and stores data locally on your device. No user data is sent to any servers.
                  </p>
                  <p>
                    The project aims to provide a modern, user-friendly interface for accessing and managing IPTV content from various public sources, with features like channel categorization, favorites, and watch history.
                  </p>
                </div>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg hover:bg-gray-750 transition-colors">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-500" />
                  Privacy & Data
                </h3>
                <div className="space-y-4 text-gray-300">
                  <p>
                    <strong>Your privacy matters:</strong>
                  </p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>All data is stored locally on your device</li>
                    <li>No analytics or tracking is implemented</li>
                    <li>No account creation or user information is collected</li>
                    <li>No ads or third-party tracking scripts</li>
                  </ul>
                  <p className="bg-blue-900/30 border border-blue-800 p-3 rounded-md">
                    The application only connects to the internet to fetch playlist content that you explicitly add.
                  </p>
                </div>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg hover:bg-gray-750 transition-colors md:col-span-2">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-white" />
                  Open Source
                </h3>
                <div className="space-y-4 text-gray-300">
                  <p>
                    This project is inspired by various open source IPTV clients and providers. We believe in the power of open source software and community-driven development.
                  </p>
                  <p>
                    We're grateful to the developers of libraries and tools that make this application possible, and to the content providers who make their streams publicly available.
                  </p>
                  
                  <div className="mt-4 pt-4 border-t border-gray-700">
                    <h4 className="font-medium mb-2">Support</h4>
                    <p>
                      For support, questions, or feedback about this application, please contact us:
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Mail className="w-5 h-5 text-blue-400" />
                      <a href="mailto:example@email.com" className="text-blue-400 hover:underline">
                        example@email.com
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Features tab */}
        {activeTab === 'features' && (
          <div>
            <div className="grid gap-8 md:grid-cols-3">
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="bg-blue-800/30 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                  <Monitor className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-lg font-medium mb-2">Playlist Management</h3>
                <p className="text-gray-400">
                  Add and manage multiple M3U8 playlists from various sources, including URLs and local files.
                </p>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="bg-green-800/30 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                  <Globe className="w-6 h-6 text-green-400" />
                </div>
                <h3 className="text-lg font-medium mb-2">Region Browsing</h3>
                <p className="text-gray-400">
                  Browse channels by country, category, or language with an intuitive filtering interface.
                </p>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="bg-red-800/30 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                  <Heart className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-lg font-medium mb-2">Favorites Collection</h3>
                <p className="text-gray-400">
                  Save your favorite channels for quick access and organize your personal collection.
                </p>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="bg-purple-800/30 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                  <Database className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg font-medium mb-2">Local Storage</h3>
                <p className="text-gray-400">
                  All your data is stored locally for privacy and offline access to your playlist information.
                </p>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="bg-yellow-800/30 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                  <Tv className="w-6 h-6 text-yellow-400" />
                </div>
                <h3 className="text-lg font-medium mb-2">Picture-in-Picture</h3>
                <p className="text-gray-400">
                  Continue watching while browsing other channels with picture-in-picture support.
                </p>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="bg-teal-800/30 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                  <Info className="w-6 h-6 text-teal-400" />
                </div>
                <h3 className="text-lg font-medium mb-2">Responsive Design</h3>
                <p className="text-gray-400">
                  Enjoy a seamless experience on any device with our responsive layout and adaptive controls.
                </p>
              </div>
            </div>

            <div className="bg-gray-800 p-6 rounded-lg mt-8">
              <h3 className="text-xl font-semibold mb-4">Complete Features List</h3>
              <ul className="grid md:grid-cols-2 gap-x-12 gap-y-3 text-gray-300">
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Add and manage multiple IPTV playlists
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Browse channels by country, category, or language
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Create a personal favorites collection
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Track watch history
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Picture-in-picture support
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Channel search and filtering
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Local storage for offline access
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Responsive design for mobile and desktop
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Stream quality selection
                </li>
                <li className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-blue-400" />
                  Channel metadata display
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Technical tab */}
        {activeTab === 'technical' && (
          <div>
            <div className="grid gap-8 md:grid-cols-2">
              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Code className="w-5 h-5 text-purple-500" />
                  Technical Details
                </h3>
                <div className="space-y-4 text-gray-300">
                  <p>
                    IPTV Streamer is built using modern web technologies:
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-700 p-4 rounded-lg">
                      <h4 className="font-medium mb-2 text-purple-400">Preact</h4>
                      <p className="text-sm text-gray-400">A lightweight alternative to React for building user interfaces</p>
                    </div>
                    <div className="bg-gray-700 p-4 rounded-lg">
                      <h4 className="font-medium mb-2 text-red-400">HLS.js</h4>
                      <p className="text-sm text-gray-400">For streaming video content with HTTP Live Streaming protocol</p>
                    </div>
                    <div className="bg-gray-700 p-4 rounded-lg">
                      <h4 className="font-medium mb-2 text-green-400">IndexedDB</h4>
                      <p className="text-sm text-gray-400">For client-side data persistence and offline capabilities</p>
                    </div>
                    <div className="bg-gray-700 p-4 rounded-lg">
                      <h4 className="font-medium mb-2 text-blue-400">TailwindCSS</h4>
                      <p className="text-sm text-gray-400">For responsive styling and modern UI components</p>
                    </div>
                  </div>
                  <p>
                    The application is designed as a Progressive Web App (PWA), allowing it to work offline and be installed on supported devices.
                  </p>
                </div>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-blue-500" />
                  Architecture
                </h3>
                <div className="space-y-4 text-gray-300">
                  <p>
                    IPTV Streamer follows a component-based architecture with the following main modules:
                  </p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>
                      <strong>Core Player</strong>: Handles video streaming, playback controls, and format adaptation
                    </li>
                    <li>
                      <strong>Data Management</strong>: Manages playlists, favorites, and watch history in local storage
                    </li>
                    <li>
                      <strong>UI Components</strong>: Reusable interface elements like channel cards, navigation, and search
                    </li>
                    <li>
                      <strong>API Integration</strong>: Connects to external IPTV sources with proper error handling
                    </li>
                  </ul>
                  <div className="bg-blue-900/30 border border-blue-800 p-3 rounded-md mt-4">
                    <p className="text-sm">
                      The app uses a responsive layout that adapts to different screen sizes, from mobile devices to desktop displays.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Legal tab - Improved version */}
        {activeTab === 'legal' && (
          <div>
            <div className="bg-gradient-to-r from-gray-800 to-gray-900 p-6 rounded-lg mb-8">
              <div className="flex flex-col md:flex-row gap-6 items-center">
                <div className="bg-blue-900/30 p-4 rounded-full">
                  <Scale className="w-10 h-10 text-blue-300" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-bold mb-2">Legal Information</h2>
                  <p className="text-gray-300 md:text-lg">
                    Please review our legal notices, disclaimers, and terms of use to understand your rights and responsibilities when using our service.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              {/* Legal Notice - Enhanced */}
              <div className="bg-gray-800 p-6 rounded-lg overflow-hidden relative">
                <div className="absolute top-0 right-0 w-32 h-32 -mt-10 -mr-10 bg-green-900/20 rounded-full blur-3xl"></div>
                <div className="relative z-10">
                  <div className="flex items-start gap-3 mb-5">
                    <div className="p-2 bg-green-900/30 rounded-lg mt-1">
                      <Shield className="w-5 h-5 text-green-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">Legal Notice</h3>
                      <p className="text-gray-400 text-sm">Content Responsibility</p>
                    </div>
                  </div>
                  <div className="space-y-4 text-gray-300">
                    <p>
                      IPTV Streamer is a web application that provides access to publicly available IPTV streams. We do not host, upload, store, or broadcast any content. All content accessed through our service comes from third-party sources that are publicly available on the internet.
                    </p>
                    <p>
                      We respect intellectual property rights and comply with copyright laws. Our service functions as a search and organization tool for publicly available content only.
                    </p>
                    <div className="bg-green-900/20 border-l-4 border-green-500 p-4 rounded-r-lg mt-5">
                      <h4 className="font-medium text-green-300 mb-2">Copyright Claims</h4>
                      <p className="text-gray-300">
                        If you are a content owner and believe your content is being shared improperly through our platform, please contact us at example@email.com with the following information:
                      </p>
                      <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-400 text-sm">
                        <li>Identification of the copyrighted work claimed to be infringed</li>
                        <li>Identification of the material that is claimed to be infringing</li>
                        <li>Your contact information</li>
                        <li>A statement that you have a good faith belief that use of the material is not authorized</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* Disclaimer - Enhanced */}
              <div className="bg-gray-800 p-6 rounded-lg overflow-hidden relative">
                <div className="absolute top-0 right-0 w-32 h-32 -mt-10 -mr-10 bg-yellow-900/20 rounded-full blur-3xl"></div>
                <div className="relative z-10">
                  <div className="flex items-start gap-3 mb-5">
                    <div className="p-2 bg-yellow-900/30 rounded-lg mt-1">
                      <AlertTriangle className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">Disclaimer</h3>
                      <p className="text-gray-400 text-sm">User Responsibility</p>
                    </div>
                  </div>
                  <div className="space-y-4 text-gray-300">
                    <p>
                      <strong>Use at your own risk:</strong> This application is provided "as is" and "as available" without any warranties of any kind. We do not guarantee the accuracy, completeness, or reliability of any content accessed through our service.
                    </p>
                    <p>
                      Users are solely responsible for ensuring they have the legal right to access any content in their jurisdiction. Geographic restrictions, licensing agreements, and local laws may limit access to certain content.
                    </p>
                    <div className="bg-yellow-900/20 border border-yellow-800/50 p-4 rounded-lg mt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-yellow-400" />
                        <h4 className="font-medium text-yellow-300">Important Notes</h4>
                      </div>
                      <ul className="list-disc pl-5 space-y-2 text-gray-300">
                        <li>We are not responsible for the content of external streams</li>
                        <li>Stream availability and quality depend on third-party providers</li>
                        <li>Access to certain content may be restricted in your region</li>
                        <li>We do not verify the legality of individual streams in every jurisdiction</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Terms of Use - Enhanced */}
              <div className="bg-gray-800 p-6 rounded-lg overflow-hidden relative md:col-span-2">
                <div className="absolute top-0 right-0 w-40 h-40 -mt-10 -mr-10 bg-blue-900/20 rounded-full blur-3xl"></div>
                <div className="relative z-10">
                  <div className="flex items-start gap-3 mb-5">
                    <div className="p-2 bg-blue-900/30 rounded-lg mt-1">
                      <FileText className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">Terms of Use</h3>
                      <p className="text-gray-400 text-sm">User Agreement</p>
                    </div>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="space-y-4 text-gray-300">
                      <p>
                        By accessing or using IPTV Streamer, you agree to comply with and be bound by these Terms of Use. If you disagree with any part of these terms, you may not access or use our service.
                      </p>
                      
                      <h4 className="font-medium text-blue-300">Acceptable Use</h4>
                      <p className="text-sm text-gray-400">You agree to use this application only for:</p>
                      <ul className="list-disc pl-5 space-y-1 text-gray-300">
                        <li>Personal, non-commercial purposes</li>
                        <li>Accessing content you have the legal right to access</li>
                        <li>Purposes that comply with all applicable laws and regulations</li>
                      </ul>
                      
                      <h4 className="font-medium text-blue-300 mt-5">Prohibited Activities</h4>
                      <ul className="list-disc pl-5 space-y-1 text-gray-300">
                        <li>Redistributing, selling, or commercializing any part of the application</li>
                        <li>Attempting to circumvent technological protection measures</li>
                        <li>Using the service for illegal activities or to access unauthorized content</li>
                        <li>Reverse engineering or modifying the application</li>
                      </ul>
                    </div>
                    
                    <div className="space-y-4 text-gray-300">
                      <h4 className="font-medium text-blue-300">Modifications</h4>
                      <p>
                        We reserve the right to modify or replace these Terms at any time. Your continued use of the application after any changes constitutes acceptance of the new Terms.
                      </p>
                      
                      <h4 className="font-medium text-blue-300 mt-5">Termination</h4>
                      <p>
                        We may terminate or suspend your access to our service immediately, without prior notice or liability, for any reason whatsoever, including if you breach the Terms.
                      </p>
                      
                      <div className="bg-blue-900/20 border border-blue-800/50 p-4 rounded-lg mt-5">
                        <h4 className="font-medium text-blue-300 mb-2">Privacy Policy</h4>
                        <p className="text-gray-300">
                          Our application respects your privacy and operates with these principles:
                        </p>
                        <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-400 text-sm">
                          <li>All data is stored locally on your device</li>
                          <li>We do not collect or transmit personal information</li>
                          <li>No usage analytics or tracking</li>
                          <li>No third-party advertising services</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Warning Section */}
              <div className="md:col-span-2 bg-red-900/20 border border-red-800/50 p-5 rounded-lg mt-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-red-900/30 rounded-full">
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-red-300 mb-2">Important Legal Advisory</h3>
                    <p className="text-gray-300">
                      IPTV Streamer is intended for accessing legally available content only. We strongly advise against using this tool to access unauthorized copyrighted content. Users are solely responsible for ensuring compliance with local laws regarding content access and streaming.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-12 text-center text-sm text-gray-500">
        <p>IPTV Streamer © {new Date().getFullYear()} | All Rights Reserved</p>
      </div>
    </div>
  );
}
