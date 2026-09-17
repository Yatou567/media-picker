// The browser chooses filenames from HTTP headers, preserving unknown MIME types.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'MP_DOWNLOAD') return;
  (async () => {
    const items = Array.isArray(message.items) ? message.items.slice(0, 100) : [];
    const results = [];
    for (const item of items) {
      try {
        if (typeof item.url !== 'string' || !/^(https?:\/\/|data:(image|audio|video)\/)/i.test(item.url)) {
          throw new Error('此资源不是可直接下载的媒体链接');
        }
        if (/\.(m3u8|mpd)(?:[?#]|$)/i.test(item.url)) throw new Error('分片播放清单不能直接下载为完整视频');
        const options = {url: item.url, conflictAction: 'uniquify', saveAs: message.saveAs === true};
        if (item.url.startsWith('data:')) {
          const mime = item.url.slice(5).split(/[;,]/)[0];
          const ext = {'image/svg+xml':'svg','image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','audio/mpeg':'mp3','video/mp4':'mp4'}[mime] || mime.split('/')[1]?.replace(/[^a-z0-9]/gi,'') || 'bin';
          options.filename = `拾光-${Date.now()}.${ext}`;
        }
        const id = await chrome.downloads.download(options);
        results.push({url: item.url, id});
      } catch (error) { results.push({url: item.url, error: error.message}); }
    }
    respond({results});
  })().catch(error => respond({error: error.message}));
  return true;
});
