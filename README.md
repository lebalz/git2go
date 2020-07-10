# Git2Go

![Git2Go](logo.png)

Install the extension from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=lebalz.git2go).


Git2go installs Git to your windows or osx computer. A package manager is used for the installation ([Chocolatey](https://chocolatey.org/) on windows, [Homebrew](https://brew.sh/index_de) on osx).

The git installation is configured with `name` and `email` and if not present new ssh keys are generated. 

# Commands

- `Git2Go: Install` installs git and configures git on your computer.
- `Git2Go: Configure` (Re)configures git.
- `Git2Go: Copy public ssh key` copy the public key to the clipboard

[GitHub](https://github.com/lebalz/git2go)


# Develop

This project contains git submodules. To get started, run

```sh
git clone git@github.com:lebalz/git2go.git
git submodule init
git submodule update
```

To install the node modules, run

```sh
yarn install
```

To fetch changes from the submodules, run

```sh
git submodule update --remote
```