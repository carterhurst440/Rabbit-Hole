import http.server, socketserver, functools

DIR = "/Users/admin/Desktop/RABBIT-HOLE"
PORT = 4321

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIR)
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"serving {DIR} on http://localhost:{PORT}")
    httpd.serve_forever()
