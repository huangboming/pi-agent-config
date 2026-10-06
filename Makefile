.PHONY: install setup update

install:
	curl -fsSL https://pi.dev/install.sh | sh

setup:
	./scripts/setup.sh

update:
	pi update --all
