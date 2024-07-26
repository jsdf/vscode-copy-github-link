publish:
	git add --all
	git commit -m "Update"
	git push

	npm install -g @vscode/vsce
	vsce login XiaochenCui
	vsce package
	vsce publish