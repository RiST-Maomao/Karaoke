# 開発用サーバ（キャッシュ無効）: python tools/devserver.py [port]
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json'}

    def do_PUT(self):
        # 開発用：画像などの確認用に tools/_debug/ へ保存（ローカルのみ）
        import os
        name = os.path.basename(self.path)
        os.makedirs('tools/_debug', exist_ok=True)
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        with open(os.path.join('tools/_debug', name), 'wb') as f:
            f.write(data)
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ThreadingHTTPServer(('', port), NoCache).serve_forever()
