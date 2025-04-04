# IPTV Streamer

![IPTV Streamer Logo](public/favicon.png)

IPTV Streamer is a modern, web-based application for accessing and managing publicly available IPTV channels. Built with privacy in mind, it runs entirely in your browser and stores all data locally on your device.

## Features

- **Playlist Management**: Add and manage M3U8 playlists from various sources
- **Channel Organization**: Browse channels by country, category, or language
- **Favorites Collection**: Save your preferred channels for quick access
- **Watch History**: Keep track of recently watched channels
- **Picture-in-Picture Support**: Continue watching while browsing other content
- **Privacy-Focused**: All data is stored locally, no tracking or analytics
- **Cross-Platform**: Works on desktop and mobile devices
- **Responsive Design**: Adapts to any screen size
- **Stream Quality Selection**: Choose stream quality where available
- **Customizable Interface**: Grid and list views for channel browsing

## Getting Started

### Installation

#### Option 1: Use the live version

The application is available at [https://your-deployment-url.com](https://your-deployment-url.com)

#### Option 2: Run locally

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/iptv-streamer.git
   cd iptv-streamer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

## Usage

### Adding Playlists

1. Navigate to the Settings page
2. Enter the URL of an M3U8 playlist
3. Give the playlist a name
4. Click "Add Playlist"

### Browsing Channels

- Use the "Browse by Country" page to find channels by region
- Use categories to filter by content type (News, Sports, Entertainment, etc.)
- Search for specific channels using the search bar

### Watching Channels

- Click on any channel to start streaming
- Use the player controls to adjust volume, enter fullscreen, or enable PiP mode
- Add channels to favorites by clicking the heart icon

## Technical Details

IPTV Streamer is built using:

- **Preact**: A lightweight alternative to React
- **HLS.js**: For streaming video content
- **IndexedDB**: For local data persistence
- **TailwindCSS**: For responsive styling
- **Lucide Icons**: For clean, minimal UI icons

The application is designed as a Progressive Web App (PWA), allowing it to work offline and be installed on supported devices.

## Legal Notice

IPTV Streamer only provides links to publicly available streams. We do not host, upload, or store any content. Users are responsible for ensuring they have the legal right to access content in their jurisdiction.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [IPTV-Org](https://github.com/iptv-org) for providing a comprehensive database of publicly available IPTV channels
- All the developers of the open-source libraries used in this project
